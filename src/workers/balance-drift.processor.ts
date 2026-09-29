import { Blockchain } from '@prisma/client';

import type {
    BalanceRepository,
    SnapshotForReconciliation,
} from '../repositories/balance.repository.js';
import type { TokenEventCursorRepository } from '../repositories/token-event-cursor.repository.js';
import type { BalanceReconciliationService } from '../services/balance-reconciliation.service.js';
import { getLogger } from '../observability/logger.js';
import {
    BALANCE_CHECK_RESULTS,
    balanceReconciliationLastSweepTimestamp,
    balanceReconciliationSnapshots,
    type BalanceCheckResult,
} from '../observability/reconciliation.metrics.js';

type ResultCounts = Record<BalanceCheckResult, number>;

export interface BalanceDriftSweepSummary {
    checked: number;
    byBlockchain: Partial<Record<Blockchain, ResultCounts>>;
}

/**
 * Sweeps every BalanceSnapshot and compares it with the chain.
 *
 * WHY THE READ IS PINNED TO THE INDEXER'S FRONTIER, NOT "LATEST"
 * ADR-013 noted that a MISMATCH against the chain head cannot tell indexer
 * lag from real drift. A busy wallet is always a few blocks behind head, so
 * alerting on head-vs-snapshot would cry wolf constantly. Instead each token
 * is read at `TokenEventCursor.lastProcessedBlock` (F): the position the
 * indexer itself claims to have fully processed. If the snapshot's balance
 * differs from the chain at F, there is no lag explanation left — an event at
 * or before F was missed, applied wrongly, or the snapshot was altered.
 *
 * Ordering matters: cursors are read BEFORE the snapshots are compared, so
 * the snapshot can only be as new or newer than F. A snapshot that got ahead
 * of F comes back STALE_OBSERVATION (skipped), never a false drift. The
 * listener advances the cursor only after syncing balances, so the reverse
 * (cursor ahead of snapshot) genuinely means a missed update.
 *
 * This costs one RPC read per snapshot. Reads run with bounded concurrency so
 * a large sweep does not burst the RPC provider.
 */
export class BalanceDriftProcessor {
    constructor(
        private readonly balances: Pick<BalanceRepository, 'findPageForReconciliation'>,
        private readonly cursors: Pick<TokenEventCursorRepository, 'findByTokenId'>,
        private readonly reconciliation: Pick<BalanceReconciliationService, 'reconcile'>,
        private readonly pageSize = 200,
        private readonly concurrency = 5,
    ) {}

    async sweep(): Promise<BalanceDriftSweepSummary> {
        const summary: BalanceDriftSweepSummary = { checked: 0, byBlockchain: {} };

        // Per-sweep cache: one cursor read per token, taken before any of
        // that token's snapshots are compared (see ordering note above).
        const frontier = new Map<string, bigint | null>();

        let afterId: string | undefined;

        for (;;) {
            const page = await this.balances.findPageForReconciliation(afterId, this.pageSize);

            if (page.length === 0) {
                break;
            }

            for (let i = 0; i < page.length; i += this.concurrency) {
                const batch = page.slice(i, i + this.concurrency);

                // The frontier must be resolved before the batch's snapshots
                // are compared; resolving inside checkOne, after the
                // snapshot was read, would allow cursor-ahead-of-snapshot.
                // Unique IDs only: batch rows share tokens, and concurrent
                // cache misses would each issue their own read.
                const tokenIds = [...new Set(batch.map((row) => row.tokenId))];
                await Promise.all(tokenIds.map((id) => this.resolveFrontier(id, frontier)));

                const results = await Promise.all(
                    batch.map((row) => this.checkOne(row, frontier.get(row.tokenId) ?? null)),
                );

                results.forEach((result, index) => {
                    this.tally(summary, batch[index].token.blockchain, result);
                });
            }

            afterId = page[page.length - 1].id;

            if (page.length < this.pageSize) {
                break;
            }
        }

        this.publish(summary);

        return summary;
    }

    private async resolveFrontier(tokenId: string, cache: Map<string, bigint | null>) {
        if (cache.has(tokenId)) {
            return;
        }

        const cursor = await this.cursors.findByTokenId(tokenId);

        // A cursor at 0 means the indexer has not completed a sync for this
        // token yet — there is no frontier to compare against.
        cache.set(
            tokenId,
            cursor && cursor.lastProcessedBlock > 0n ? cursor.lastProcessedBlock : null,
        );
    }

    private async checkOne(
        row: SnapshotForReconciliation,
        frontier: bigint | null,
    ): Promise<BalanceCheckResult> {
        if (frontier === null) {
            getLogger().warn(
                { walletId: row.walletId, tokenId: row.tokenId },
                'balance.drift.unverified.no_cursor',
            );

            return 'unverified';
        }

        try {
            const result = await this.reconciliation.reconcile({
                walletId: row.walletId,
                walletAddress: row.wallet.address,
                walletChainId: row.wallet.chainId,
                tokenId: row.tokenId,
                blockchain: row.token.blockchain,
                assetIdentifier: row.token.contractAddress ?? undefined,
                blockNumber: frontier,
            });

            switch (result.status) {
                case 'MATCH':
                    return 'match';

                case 'STALE_OBSERVATION':
                    return 'stale_observation';

                case 'MISMATCH':
                    // bigint is not JSON-serializable by the logger.
                    getLogger().error(
                        {
                            walletId: row.walletId,
                            tokenId: row.tokenId,
                            symbol: row.token.symbol,
                            blockchain: row.token.blockchain,
                            frontier: frontier.toString(),
                            persisted: result.persisted && {
                                balance: result.persisted.balance.toString(),
                                blockNumber: result.persisted.blockNumber.toString(),
                            },
                            chain: {
                                balance: result.chain.balance.toString(),
                                blockNumber: result.chain.blockNumber.toString(),
                            },
                        },
                        'balance.drift.detected',
                    );

                    return 'drift';
            }
        } catch (error) {
            // One bad read (RPC hiccup, unsupported chain, pruned state)
            // must not abort the sweep or be mistaken for drift.
            getLogger().warn(
                {
                    walletId: row.walletId,
                    tokenId: row.tokenId,
                    blockchain: row.token.blockchain,
                    error: error instanceof Error ? error.message : String(error),
                },
                'balance.drift.unverified.check_failed',
            );

            return 'unverified';
        }
    }

    private tally(
        summary: BalanceDriftSweepSummary,
        blockchain: Blockchain,
        result: BalanceCheckResult,
    ) {
        summary.checked += 1;
        summary.byBlockchain[blockchain] ??= emptyCounts();
        summary.byBlockchain[blockchain]![result] += 1;
    }

    /**
     * Publishes only after the whole sweep finished (an exception above
     * skips this), and writes every blockchain x result series so a
     * repaired drift drops back to 0 instead of lingering at its old value.
     */
    private publish(summary: BalanceDriftSweepSummary) {
        for (const blockchain of Object.values(Blockchain)) {
            const counts = summary.byBlockchain[blockchain] ?? emptyCounts();

            for (const result of BALANCE_CHECK_RESULTS) {
                balanceReconciliationSnapshots.set({ blockchain, result }, counts[result]);
            }
        }

        balanceReconciliationLastSweepTimestamp.set(Date.now() / 1000);

        getLogger().info(
            { checked: summary.checked, byBlockchain: summary.byBlockchain },
            'balance.drift.sweep.completed',
        );
    }
}

function emptyCounts(): ResultCounts {
    return { match: 0, drift: 0, stale_observation: 0, unverified: 0 };
}

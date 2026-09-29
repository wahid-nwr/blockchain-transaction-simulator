import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BalanceDriftProcessor } from '../../src/workers/balance-drift.processor.js';
import {
    balanceReconciliationLastSweepTimestamp,
    balanceReconciliationSnapshots,
} from '../../src/observability/reconciliation.metrics.js';
import { registry } from '../../src/observability/metrics.js';
import { ANVIL_CHAIN_ID } from '../../src/blockchain/wallet-address.js';

const row = (id: string, tokenId = 'token-1', blockchain: 'EVM' | 'SOLANA' = 'EVM') => ({
    id,
    walletId: `wallet-${id}`,
    tokenId,
    wallet: { address: `0xwallet${id}`, chainId: ANVIL_CHAIN_ID },
    token: { blockchain, contractAddress: '0xtoken', symbol: 'USDT' },
});

const reconciled = (status: 'MATCH' | 'MISMATCH' | 'STALE_OBSERVATION') => ({
    status,
    blockchain: 'EVM',
    walletId: 'w',
    tokenId: 't',
    persisted: { balance: 10n, blockNumber: 90n },
    chain: { balance: status === 'MATCH' ? 10n : 25n, blockNumber: 100n },
});

async function gauge(blockchain: string, result: string) {
    const metric = await balanceReconciliationSnapshots.get();
    return metric.values.find(
        (v) => v.labels.blockchain === blockchain && v.labels.result === result,
    )?.value;
}

describe('BalanceDriftProcessor', () => {
    const balances = { findPageForReconciliation: vi.fn() };
    const cursors = { findByTokenId: vi.fn() };
    const reconciliation = { reconcile: vi.fn() };

    const make = (pageSize = 200, concurrency = 5) =>
        new BalanceDriftProcessor(balances, cursors, reconciliation, pageSize, concurrency);

    beforeEach(() => {
        vi.clearAllMocks();
        registry.resetMetrics();

        balances.findPageForReconciliation.mockResolvedValueOnce([row('a')]);
        cursors.findByTokenId.mockResolvedValue({ lastProcessedBlock: 100n });
    });

    it('reads each snapshot at the indexer frontier, not at latest', async () => {
        reconciliation.reconcile.mockResolvedValue(reconciled('MATCH'));

        await make().sweep();

        expect(reconciliation.reconcile).toHaveBeenCalledWith(
            expect.objectContaining({
                walletId: 'wallet-a',
                assetIdentifier: '0xtoken',
                blockNumber: 100n,
            }),
        );
    });

    it('classifies MATCH, MISMATCH and STALE_OBSERVATION', async () => {
        balances.findPageForReconciliation.mockReset();
        balances.findPageForReconciliation.mockResolvedValueOnce([row('a'), row('b'), row('c')]);
        reconciliation.reconcile
            .mockResolvedValueOnce(reconciled('MATCH'))
            .mockResolvedValueOnce(reconciled('MISMATCH'))
            .mockResolvedValueOnce(reconciled('STALE_OBSERVATION'));

        const summary = await make().sweep();

        expect(summary.checked).toBe(3);
        expect(summary.byBlockchain.EVM).toEqual({
            match: 1,
            drift: 1,
            stale_observation: 1,
            unverified: 0,
        });
    });

    it('marks snapshots unverified when the token has no indexer cursor yet', async () => {
        cursors.findByTokenId.mockResolvedValue(null);

        const summary = await make().sweep();

        expect(reconciliation.reconcile).not.toHaveBeenCalled();
        expect(summary.byBlockchain.EVM?.unverified).toBe(1);
    });

    it('treats a cursor at block 0 as no frontier', async () => {
        cursors.findByTokenId.mockResolvedValue({ lastProcessedBlock: 0n });

        const summary = await make().sweep();

        expect(reconciliation.reconcile).not.toHaveBeenCalled();
        expect(summary.byBlockchain.EVM?.unverified).toBe(1);
    });

    it('does not let one failing read abort the sweep or count as drift', async () => {
        balances.findPageForReconciliation.mockReset();
        balances.findPageForReconciliation.mockResolvedValueOnce([row('a'), row('b')]);
        reconciliation.reconcile
            .mockRejectedValueOnce(new Error('rpc timeout'))
            .mockResolvedValueOnce(reconciled('MATCH'));

        const summary = await make().sweep();

        expect(summary.byBlockchain.EVM).toEqual({
            match: 1,
            drift: 0,
            stale_observation: 0,
            unverified: 1,
        });
    });

    it('reads a token cursor once per sweep however many snapshots it has', async () => {
        balances.findPageForReconciliation.mockReset();
        balances.findPageForReconciliation.mockResolvedValueOnce([row('a'), row('b'), row('c')]);
        reconciliation.reconcile.mockResolvedValue(reconciled('MATCH'));

        await make().sweep();

        expect(cursors.findByTokenId).toHaveBeenCalledTimes(1);
    });

    it('pages through all snapshots using the last id as the cursor', async () => {
        balances.findPageForReconciliation.mockReset();
        balances.findPageForReconciliation
            .mockResolvedValueOnce([row('a'), row('b')])
            .mockResolvedValueOnce([row('c')]);
        reconciliation.reconcile.mockResolvedValue(reconciled('MATCH'));

        const summary = await make(2).sweep();

        expect(summary.checked).toBe(3);
        expect(balances.findPageForReconciliation).toHaveBeenNthCalledWith(1, undefined, 2);
        expect(balances.findPageForReconciliation).toHaveBeenNthCalledWith(2, 'b', 2);
    });

    it('bounds concurrent reads', async () => {
        balances.findPageForReconciliation.mockReset();
        balances.findPageForReconciliation.mockResolvedValueOnce(
            ['a', 'b', 'c', 'd', 'e'].map((id) => row(id)),
        );

        let inFlight = 0;
        let peak = 0;
        reconciliation.reconcile.mockImplementation(async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;
            return reconciled('MATCH');
        });

        await make(200, 2).sweep();

        expect(peak).toBe(2);
    });

    it('publishes gauges, zeroing blockchains and results with no snapshots', async () => {
        reconciliation.reconcile.mockResolvedValue(reconciled('MISMATCH'));

        await make().sweep();

        expect(await gauge('EVM', 'drift')).toBe(1);
        expect(await gauge('EVM', 'match')).toBe(0);
        expect(await gauge('SOLANA', 'drift')).toBe(0);
        expect(
            (await balanceReconciliationLastSweepTimestamp.get()).values[0].value,
        ).toBeGreaterThan(0);
    });

    it('drops a repaired drift back to 0 on the next sweep', async () => {
        reconciliation.reconcile.mockResolvedValueOnce(reconciled('MISMATCH'));
        await make().sweep();
        expect(await gauge('EVM', 'drift')).toBe(1);

        balances.findPageForReconciliation.mockResolvedValueOnce([row('a')]);
        reconciliation.reconcile.mockResolvedValueOnce(reconciled('MATCH'));
        await make().sweep();

        expect(await gauge('EVM', 'drift')).toBe(0);
    });

    it('does not advance the last-sweep timestamp when the sweep throws', async () => {
        balances.findPageForReconciliation.mockReset();
        balances.findPageForReconciliation.mockRejectedValueOnce(new Error('db down'));

        await expect(make().sweep()).rejects.toThrow('db down');

        // A label-less prom-client gauge exports 0 until set.
        expect((await balanceReconciliationLastSweepTimestamp.get()).values[0].value).toBe(0);
    });
});

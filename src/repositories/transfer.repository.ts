import { prisma } from '../database/prisma.js';

export class TransferRepository {
    async create(data: {
        tokenId: string;
        from: string;
        to: string;
        amount: bigint;
        transactionHash: string;
        logIndex: number;
        blockNumber: bigint;
    }) {
        return await prisma.tokenTransfer.upsert({
            where: {
                transactionHash_logIndex: {
                    transactionHash: data.transactionHash,
                    logIndex: data.logIndex,
                },
            },
            create: data,
            update: {},
        });
    }

    async findByTransactionHashAndLogIndex(transactionHash: string, logIndex: number) {
        return prisma.tokenTransfer.findUnique({
            where: {
                transactionHash_logIndex: {
                    transactionHash,
                    logIndex,
                },
            },
        });
    }

    /**
     * Best-effort correlation for orphaned-PENDING recovery
     * (PendingRecoveryScheduler): TokenTransfer rows are written
     * independently by the on-chain event listener, not by the (possibly
     * crashed) API request that created the PENDING transaction — so a
     * match here is evidence the transfer actually broadcast successfully
     * on-chain even though our own request never got to record its hash.
     *
     * This is a heuristic, not a guaranteed identity match: from/to/amount
     * is the strongest correlation available, because the underlying
     * ERC-20 `transfer()` call has no field to carry our internal
     * transaction id on-chain. Two genuinely distinct transfers of the
     * same amount between the same two wallets, both broadcast after
     * `notBefore`, are indistinguishable by this query — see
     * docs/runbooks/confirmation-worker-lag.md for the acknowledged
     * limitation. `notBefore` should be the orphaned transaction's
     * `createdAt`: a transfer can't be evidence of a submission that
     * hadn't been requested yet.
     */
    async findMatchingTransfer(params: {
        tokenId: string;
        from: string;
        to: string;
        amount: bigint;
        notBefore: Date;
    }) {
        return prisma.tokenTransfer.findFirst({
            where: {
                tokenId: params.tokenId,
                from: params.from,
                to: params.to,
                amount: params.amount,
                createdAt: {
                    gte: params.notBefore,
                },
            },
            orderBy: {
                createdAt: 'asc',
            },
        });
    }
}

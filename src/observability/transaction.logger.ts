import { getLogger } from './logger.js';

export function logTransactionEvent(
    operation: string,
    data: {
        tenantId?: string;
        transactionId?: string;
        tokenId?: string;
        walletId?: string;
        txHash?: string;
        blockNumber?: number;
        status?: string;
        amount?: bigint | string;
        durationMs?: number;
        worker?: string;
        cycleId?: string;
        error?: unknown;
    },
) {
    const logger = getLogger();

    logger.info(
        {
            operation,
            tenantId: data.tenantId,
            transactionId: data.transactionId,
            tokenId: data.tokenId,
            walletId: data.walletId,
            txHash: data.txHash,
            blockNumber: data.blockNumber,
            status: data.status,
            amount: data.amount?.toString(),
            durationMs: data.durationMs,
            worker: data.worker,
            cycleId: data.cycleId,
        },
        'transaction lifecycle event',
    );
}

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { IdempotencyKeyRepository } from '../repositories/idempotency-key.repository.js';

export const IDEMPOTENCY_STATUS = {
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
} as const;

export class IdempotencyService {
    constructor(private readonly repository: IdempotencyKeyRepository) {}

    hashRequest(input: {
        tokenId: string;
        fromWalletId: string;
        toWalletId: string;
        amount: string;
    }): string {
        const canonical = JSON.stringify({
            amount: input.amount,
            fromWalletId: input.fromWalletId,
            toWalletId: input.toWalletId,
            tokenId: input.tokenId,
        });

        return createHash('sha256').update(canonical).digest('hex');
    }

    async find(tenantId: string, key: string) {
        return this.repository.findByKey(tenantId, key);
    }

    async acquire(tenantId: string, key: string, requestHash: string, ttlMs: number) {
        return this.repository.create({
            tenantId,
            key,
            requestHash,
            status: IDEMPOTENCY_STATUS.PROCESSING,
            expiresAt: new Date(Date.now() + ttlMs),
        });
    }

    async markCompleted(id: string, transactionId: string, response: Prisma.InputJsonValue) {
        return this.repository.markCompleted(id, transactionId, response);
    }

    async markFailed(id: string, response?: Prisma.InputJsonValue) {
        return this.repository.markFailed(id, response);
    }
}

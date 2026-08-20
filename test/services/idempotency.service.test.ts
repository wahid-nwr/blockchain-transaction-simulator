import { describe, expect, it, vi } from 'vitest';

import { IDEMPOTENCY_STATUS, IdempotencyService } from '../../src/services/idempotency.service.js';

describe('IdempotencyService', () => {
    const repository = {
        findByKey: vi.fn(),
        create: vi.fn(),
        markCompleted: vi.fn(),
        markFailed: vi.fn(),
    };

    const service = new IdempotencyService(repository as never);

    it('should produce the same hash for the same request', () => {
        const request = {
            tokenId: 'token-1',
            fromWalletId: 'wallet-1',
            toWalletId: 'wallet-2',
            amount: '1000000',
        };

        const hash1 = service.hashRequest(request);
        const hash2 = service.hashRequest(request);

        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
    });

    it('should produce different hashes for different transaction intents', () => {
        const baseRequest = {
            tokenId: 'token-1',
            fromWalletId: 'wallet-1',
            toWalletId: 'wallet-2',
            amount: '1000000',
        };

        const differentAmount = service.hashRequest({
            ...baseRequest,
            amount: '2000000',
        });

        const differentRecipient = service.hashRequest({
            ...baseRequest,
            toWalletId: 'wallet-3',
        });

        const original = service.hashRequest(baseRequest);

        expect(differentAmount).not.toBe(original);
        expect(differentRecipient).not.toBe(original);
    });

    it('should find an existing idempotency key', async () => {
        const record = {
            id: 'idem-1',
            tenantId: 'tenant-1',
            key: 'request-123',
            requestHash: 'hash-123',
            status: IDEMPOTENCY_STATUS.PROCESSING,
        };

        repository.findByKey.mockResolvedValue(record);

        await expect(service.find('tenant-1', 'request-123')).resolves.toEqual(record);

        expect(repository.findByKey).toHaveBeenCalledWith('tenant-1', 'request-123');
    });

    it('should acquire a new idempotency key as PROCESSING', async () => {
        const record = {
            id: 'idem-1',
            tenantId: 'tenant-1',
            key: 'request-123',
            requestHash: 'hash-123',
            status: IDEMPOTENCY_STATUS.PROCESSING,
        };

        repository.create.mockResolvedValue(record);

        const before = Date.now();

        const result = await service.acquire('tenant-1', 'request-123', 'hash-123', 60_000);

        const after = Date.now();

        expect(result).toEqual(record);

        expect(repository.create).toHaveBeenCalledTimes(1);

        const call = repository.create.mock.calls[0][0];

        expect(call).toMatchObject({
            tenantId: 'tenant-1',
            key: 'request-123',
            requestHash: 'hash-123',
            status: IDEMPOTENCY_STATUS.PROCESSING,
        });

        expect(call.expiresAt).toBeInstanceOf(Date);
        expect(call.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
        expect(call.expiresAt.getTime()).toBeLessThanOrEqual(after + 60_000);
    });

    it('should mark an idempotency key as completed', async () => {
        const response = {
            id: 'transaction-1',
            status: 'SUBMITTED',
        };

        const record = {
            id: 'idem-1',
            transactionId: 'transaction-1',
            status: IDEMPOTENCY_STATUS.COMPLETED,
            response,
        };

        repository.markCompleted.mockResolvedValue(record);

        await expect(service.markCompleted('idem-1', 'transaction-1', response)).resolves.toEqual(
            record,
        );

        expect(repository.markCompleted).toHaveBeenCalledWith('idem-1', 'transaction-1', response);
    });

    it('should mark an idempotency key as failed', async () => {
        const response = {
            error: 'transaction failed',
        };

        const record = {
            id: 'idem-1',
            status: IDEMPOTENCY_STATUS.FAILED,
            response,
        };

        repository.markFailed.mockResolvedValue(record);

        await expect(service.markFailed('idem-1', response)).resolves.toEqual(record);

        expect(repository.markFailed).toHaveBeenCalledWith('idem-1', response);
    });
});

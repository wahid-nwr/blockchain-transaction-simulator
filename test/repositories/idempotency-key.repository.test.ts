import { beforeEach, describe, expect, it } from 'vitest';

import { IdempotencyKeyRepository } from '../../src/repositories/idempotency-key.repository.js';
import { prisma } from '../../src/database/prisma.js';
import { CONFIRMATION_TIMEOUT_MS } from '../../src/domain/transaction/transaction-expiration.js';

describe('IdempotencyKeyRepository', () => {
    const repository = new IdempotencyKeyRepository(prisma);

    const tenantId = '00000000-0000-0000-0000-000000000001';

    beforeEach(async () => {
        await prisma.idempotencyKey.deleteMany({
            where: {
                tenantId,
            },
        });
    });

    it('should create an idempotency key as PROCESSING', async () => {
        const expiresAt = new Date(Date.now() + 60_000);

        const result = await repository.create({
            tenantId,
            key: 'request-123',
            requestHash: 'hash-123',
            status: 'PROCESSING',
            expiresAt,
        });

        expect(result.tenantId).toBe(tenantId);
        expect(result.key).toBe('request-123');
        expect(result.requestHash).toBe('hash-123');
        expect(result.status).toBe('PROCESSING');
        expect(result.expiresAt).toEqual(expiresAt);
    });

    it('should find an idempotency key by tenant and key', async () => {
        await repository.create({
            tenantId,
            key: 'request-123',
            requestHash: 'hash-123',
            status: 'PROCESSING',
            expiresAt: new Date(Date.now() + 60_000),
        });

        const result = await repository.findByKey(tenantId, 'request-123');

        expect(result).not.toBeNull();
        expect(result?.tenantId).toBe(tenantId);
        expect(result?.key).toBe('request-123');
    });

    it('should enforce uniqueness per tenant and key', async () => {
        const data = {
            tenantId,
            key: 'request-123',
            requestHash: 'hash-123',
            status: 'PROCESSING',
            expiresAt: new Date(Date.now() + 60_000),
        };

        await repository.create(data);

        await expect(repository.create(data)).rejects.toMatchObject({
            code: 'P2002',
        });
    });

    it('should allow the same key for different tenants', async () => {
        const otherTenantId = '00000000-0000-0000-0000-000000000002';

        const data = {
            key: 'request-123',
            requestHash: 'hash-123',
            status: 'PROCESSING',
            expiresAt: new Date(Date.now() + 60_000),
        };

        await repository.create({
            ...data,
            tenantId,
        });

        const result = await repository.create({
            ...data,
            tenantId: otherTenantId,
        });

        expect(result.tenantId).toBe(otherTenantId);
        expect(result.key).toBe('request-123');

        await prisma.idempotencyKey.deleteMany({
            where: {
                tenantId: otherTenantId,
            },
        });
    });

    it('should mark an idempotency key as completed', async () => {
        const tenant = await prisma.tenant.create({
            data: {
                name: `tenant-${Date.now()}`,
            },
        });

        const user = await prisma.user.create({
            data: {
                email: `user-${Date.now()}@test.com`,
                passwordHash: 'hash',
                tenantId: tenant.id,
            },
        });

        const fromWallet = await prisma.wallet.create({
            data: {
                tenantId: tenant.id,
                ownerId: user.id,
                chainId: 31337,
                address: `0xfrom${Date.now()}`,
            },
        });

        const toWallet = await prisma.wallet.create({
            data: {
                tenantId: tenant.id,
                ownerId: user.id,
                chainId: 31337,
                address: `0xto${Date.now()}`,
            },
        });

        const token = await prisma.token.create({
            data: {
                name: 'MiniUSDT',
                symbol: 'mUSDT',
                contractAddress: `0xtoken${Date.now()}`,
            },
        });

        const confirmationStartedAt = new Date(Date.now() - CONFIRMATION_TIMEOUT_MS - 1_000);

        const transaction = await prisma.transaction.create({
            data: {
                tenantId: tenant.id,
                tokenId: token.id,
                fromWalletId: fromWallet.id,
                toWalletId: toWallet.id,
                amount: 100n,
                txHash: `0xexpiration-${Date.now()}`,
                status: 'CONFIRMING',
                submittedAt: new Date(confirmationStartedAt.getTime() - 1_000),
                confirmationStartedAt,
            },
        });

        const created = await repository.create({
            tenantId: tenant.id,
            key: 'request-123',
            requestHash: `0xexpiration-${Date.now()}`,
            status: 'PROCESSING',
            expiresAt: new Date(Date.now() + 60_000),
        });

        const response = {
            id: 'transaction-123',
            status: 'SUBMITTED',
        };

        const result = await repository.markCompleted(created.id, transaction.id, response);

        expect(result.status).toBe('COMPLETED');
        expect(result.transactionId).toBe(transaction.id);
        expect(result.response).toEqual(response);
    });

    it('should mark an idempotency key as failed', async () => {
        const created = await repository.create({
            tenantId,
            key: 'request-123',
            requestHash: 'hash-123',
            status: 'PROCESSING',
            expiresAt: new Date(Date.now() + 60_000),
        });

        const response = {
            error: 'transaction failed',
        };

        const result = await repository.markFailed(created.id, response);

        expect(result.status).toBe('FAILED');
        expect(result.response).toEqual(response);
    });
});

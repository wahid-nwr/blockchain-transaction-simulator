import { beforeEach, describe, vi, expect, it } from 'vitest';

import { prisma } from '../../src/database/prisma.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import { CONFIRMATION_TIMEOUT_MS } from '../../src/domain/transaction/transaction-expiration.js';
import { ExpirationProcessor } from '../../src/workers/expiration.processor.js';
import { ExpirationScheduler } from '../../src/workers/expiration.scheduler.js';

import { waitForTransactionStatus } from '../blockchain/blockchain.helper.js';
import { cleanupDatabase } from '../helpers/cleanup.js';
import { publicClient } from '../../src/blockchain/client.js';
import { ConfirmationProcessor } from '../../src/workers/confirmation.processor.js';

describe('Transaction expiration async lifecycle', () => {
    beforeEach(async () => {
        await cleanupDatabase();
    });

    it('should expire a confirming transaction through the expiration scheduler', async () => {
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

        const repository = new TransactionRepository();
        const processor = new ExpirationProcessor(repository);
        const scheduler = new ExpirationScheduler(processor, 25);

        try {
            scheduler.start();

            const expired = await waitForTransactionStatus(transaction.id, 'EXPIRED');

            expect(expired?.status).toBe('EXPIRED');
            expect(expired?.failureReason).toBe('Transaction confirmation timeout exceeded');
            expect(expired?.failedAt).not.toBeNull();
        } finally {
            await scheduler.stop();
        }
    });

    it('should prevent confirmation from winning after expiration wins the terminal transition', async () => {
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
                txHash: `0xexpiration-race-${Date.now()}`,
                status: 'CONFIRMING',
                submittedAt: new Date(confirmationStartedAt.getTime() - 1_000),
                confirmationStartedAt,
            },
        });

        let releaseReceipt!: (receipt: {
            status: 'success';
            blockNumber: bigint;
            gasUsed: bigint;
        }) => void;

        const receiptGate = new Promise<{
            status: 'success';
            blockNumber: bigint;
            gasUsed: bigint;
        }>((resolve) => {
            releaseReceipt = resolve;
        });

        const getTransactionReceiptSpy = vi
            .spyOn(publicClient, 'getTransactionReceipt')
            .mockReturnValue(receiptGate as never);

        const repository = new TransactionRepository();

        const confirmationProcessor = new ConfirmationProcessor(repository);
        const expirationProcessor = new ExpirationProcessor(repository);
        const scheduler = new ExpirationScheduler(expirationProcessor, 25);

        try {
            const confirmationPromise = confirmationProcessor.processTransaction(
                transaction.id,
                tenant.id,
            );

            await vi.waitFor(
                () => {
                    expect(getTransactionReceiptSpy).toHaveBeenCalledTimes(1);
                },
                {
                    timeout: 5_000,
                    interval: 10,
                },
            );

            scheduler.start();

            const expired = await waitForTransactionStatus(transaction.id, 'EXPIRED');

            expect(expired.status).toBe('EXPIRED');
            expect(expired.failureReason).toBe('Transaction confirmation timeout exceeded');
            expect(expired.failedAt).not.toBeNull();

            releaseReceipt({
                status: 'success',
                blockNumber: 123n,
                gasUsed: 21_000n,
            });

            await confirmationPromise;

            const finalTransaction = await prisma.transaction.findUnique({
                where: {
                    id: transaction.id,
                },
            });

            expect(finalTransaction?.status).toBe('EXPIRED');
            expect(finalTransaction?.blockNumber).toBeNull();
            expect(finalTransaction?.gasUsed).toBeNull();
            expect(finalTransaction?.confirmedAt).toBeNull();
        } finally {
            await scheduler.stop();
            vi.restoreAllMocks();
        }
    });

    it('should prevent expiration from winning after confirmation wins the terminal transition', async () => {
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
                txHash: `0xconfirmation-wins-${Date.now()}`,
                status: 'CONFIRMING',
                submittedAt: new Date(confirmationStartedAt.getTime() - 1_000),
                confirmationStartedAt,
            },
        });

        const getTransactionReceiptSpy = vi
            .spyOn(publicClient, 'getTransactionReceipt')
            .mockResolvedValue({
                status: 'success',
                blockNumber: 123n,
                gasUsed: 21_000n,
            } as never);

        const repository = new TransactionRepository();
        const confirmationProcessor = new ConfirmationProcessor(repository);
        const expirationProcessor = new ExpirationProcessor(repository);
        const scheduler = new ExpirationScheduler(expirationProcessor, 25);

        try {
            await confirmationProcessor.processTransaction(transaction.id, tenant.id);

            const confirmed = await waitForTransactionStatus(transaction.id, 'CONFIRMED');

            expect(confirmed.status).toBe('CONFIRMED');
            expect(confirmed.blockNumber).toBe(123n);
            expect(confirmed.gasUsed).toBe(21_000n);
            expect(confirmed.confirmedAt).not.toBeNull();

            scheduler.start();

            await expirationProcessor.processExpiredTransactions(
                new Date(Date.now() - CONFIRMATION_TIMEOUT_MS),
            );

            const finalTransaction = await prisma.transaction.findUnique({
                where: {
                    id: transaction.id,
                },
            });

            expect(finalTransaction?.status).toBe('CONFIRMED');
            expect(finalTransaction?.failureReason).toBeNull();
            expect(finalTransaction?.failedAt).toBeNull();
        } finally {
            await scheduler.stop();
            getTransactionReceiptSpy.mockRestore();
        }
    });

    it('should continue scheduling after an expiration processor failure', async () => {
        const repository = new TransactionRepository();
        const processor = new ExpirationProcessor(repository);

        const processExpiredTransactionsSpy = vi
            .spyOn(processor, 'processExpiredTransactions')
            .mockRejectedValueOnce(new Error('temporary database failure'))
            .mockResolvedValueOnce(25);

        const scheduler = new ExpirationScheduler(processor, 25);

        try {
            scheduler.start();

            await vi.waitFor(
                () => {
                    expect(processExpiredTransactionsSpy).toHaveBeenCalledTimes(2);
                },
                {
                    timeout: 5_000,
                    interval: 10,
                },
            );
        } finally {
            await scheduler.stop();
        }

        expect(processExpiredTransactionsSpy).toHaveBeenCalledTimes(2);
    });
});

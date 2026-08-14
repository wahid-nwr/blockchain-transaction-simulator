import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/database/prisma.js';

import { transactionConfirmationQueue } from '../../src/queues/index.js';

import { JOBS } from '../../src/queues/job.constants.js';

import { confirmationQueueWorker } from '../../src/workers/confirmation.queue.worker.js';

import { publicClient } from '../../src/blockchain/client.js';

describe('Transaction confirmation async lifecycle', () => {
    beforeAll(async () => {
        await prisma.$connect();

        await confirmationQueueWorker.waitUntilReady();
    });

    beforeEach(async () => {
        await transactionConfirmationQueue.drain();

        await transactionConfirmationQueue.clean(0, 1000, 'completed');

        await transactionConfirmationQueue.clean(0, 1000, 'failed');
    });

    it('should confirm transaction through BullMQ worker', async () => {
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

        const txHash = `0x${'11'.repeat(32)}`;
        const transaction = await prisma.transaction.create({
            data: {
                tenantId: tenant.id,

                tokenId: token.id,

                fromWalletId: fromWallet.id,

                toWalletId: toWallet.id,

                amount: 100n,

                txHash: txHash,

                status: 'SUBMITTED',
            },
        });

        vi.spyOn(publicClient, 'getTransactionReceipt').mockResolvedValue({
            status: 'success',

            blockNumber: 123n,

            gasUsed: 21000n,
        } as any);

        const completed = new Promise<void>((resolve, reject) => {
            confirmationQueueWorker.once('completed', () => resolve());

            confirmationQueueWorker.once('failed', (_, error) => reject(error));
        });

        await transactionConfirmationQueue.add(
            JOBS.CONFIRM_TRANSACTION,

            {
                transactionId: transaction.id,

                tenantId: tenant.id,
            },

            {
                attempts: 1,

                removeOnComplete: true,
            },
        );

        await completed;

        const updated = await prisma.transaction.findUnique({
            where: {
                id: transaction.id,
            },
        });

        expect(updated?.status).toBe('CONFIRMED');

        expect(updated?.blockNumber).toBe(123n);

        expect(updated?.gasUsed).toBe(21000n);
    }, 30000);
});

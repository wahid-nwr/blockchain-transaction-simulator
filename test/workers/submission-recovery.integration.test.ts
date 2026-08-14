import { describe, it, expect, beforeEach } from 'vitest';

import { cleanupDatabase } from '../helpers/cleanup.js';
import { createAdminUser, createAuthenticatedUser } from '../helpers/auth.js';
import { deployMiniUSDT } from '../helpers/deploy.js';

import { prisma } from '../../src/database/prisma.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';

import { SubmissionRecoveryProcessor } from '../../src/workers/submission-recovery.processor.js';
import { SubmissionRecoveryScheduler } from '../../src/workers/submission-recovery.scheduler.js';
import { confirmationQueueWorker } from '../../src/workers/confirmation.queue.worker.js';

import { transactionConfirmationQueue } from '../../src/queues/index.js';

import { waitForTransactionStatus } from '../blockchain/blockchain.helper.js';
import { resetAnvil } from '../helpers/anvil-reset.js';
import { ANVIL_ACCOUNTS } from '../helpers/anvil.js';
import { randomUUID } from 'node:crypto';
import { PostgresSchedulerLease } from '../../src/scheduling/postgres-scheduler-lease.js';

describe('Submission recovery async lifecycle', () => {
    beforeEach(async () => {
        await cleanupDatabase();
        await resetAnvil();
        await transactionConfirmationQueue.drain(true);
    });

    it('should recover a submitted transaction through the recovery scheduler', async () => {
        const { app, token: adminToken } = await createAdminUser();

        const senderContext = await createAuthenticatedUser({
            walletPrivateKey: ANVIL_ACCOUNTS.user,
        });

        const receiverContext = await createAuthenticatedUser();

        const tokenAddress = await deployMiniUSDT();

        const tokenResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/tokens',
            headers: {
                authorization: `Bearer ${adminToken}`,
            },
            payload: {
                tokenId: randomUUID(),
                name: 'MiniUSDT',
                symbol: 'USDT',
                contractAddress: tokenAddress,
            },
        });

        expect(tokenResponse.statusCode).toBe(201);

        const tokenId = tokenResponse.json().data.id;

        const mintResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/tokens/${tokenId}/mint`,
            headers: {
                authorization: `Bearer ${adminToken}`,
            },
            payload: {
                receiver: senderContext.wallet.address,
                amount: '1000000000',
            },
        });

        expect(mintResponse.statusCode).toBe(200);

        const transferResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${senderContext.token}`,
            },
            payload: {
                tokenId,
                fromWalletId: senderContext.wallet.id,
                toWalletId: receiverContext.wallet.id,
                amount: '100',
            },
        });

        expect(transferResponse.statusCode).toBe(201);

        const transaction = transferResponse.json().data;

        expect(transaction.status).toBe('SUBMITTED');
        expect(transaction.txHash).toBeTruthy();

        /*
         * Simulate loss of the original confirmation job.
         */
        await transactionConfirmationQueue.drain(true);

        const submitted = await prisma.transaction.findUnique({
            where: {
                id: transaction.id,
            },
        });

        expect(submitted?.status).toBe('SUBMITTED');
        expect(submitted?.txHash).toBe(transaction.txHash);

        const repository = new TransactionRepository();
        const processor = new SubmissionRecoveryProcessor(repository);

        const scheduler = new SubmissionRecoveryScheduler(processor, new PostgresSchedulerLease(), 25);

        try {
            await confirmationQueueWorker.waitUntilReady();

            scheduler.start();

            /*
             * The scheduler should rediscover the SUBMITTED transaction,
             * enqueue a confirmation job, and the real BullMQ worker
             * should eventually confirm it.
             */
            const confirmed = await waitForTransactionStatus(transaction.id, 'CONFIRMED');

            expect(confirmed?.status).toBe('CONFIRMED');
            expect(confirmed?.txHash).toBe(transaction.txHash);
            expect(confirmed?.blockNumber).toBeDefined();
            expect(confirmed?.gasUsed).toBeDefined();
            expect(confirmed?.confirmedAt).not.toBeNull();
            expect(confirmed?.confirmationStartedAt).not.toBeNull();
        } finally {
            await scheduler.stop();
            await app.close();
        }
    });
});

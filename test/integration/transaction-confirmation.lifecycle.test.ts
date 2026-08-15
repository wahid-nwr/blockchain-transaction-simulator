import { describe, it, expect, beforeEach } from 'vitest';

import { cleanupDatabase } from '../helpers/cleanup.js';
import { createAdminUser, createAuthenticatedUser } from '../helpers/auth.js';
import { deployMiniUSDT } from '../helpers/deploy.js';
import { resetAnvil } from '../helpers/anvil-reset.js';
import { ANVIL_ACCOUNTS } from '../helpers/anvil.js';

import { confirmationQueueWorker } from '../../src/workers/confirmation.queue.worker.js';

import { waitForTransactionStatus } from '../blockchain/blockchain.helper.js';

import { randomUUID } from 'node:crypto';

describe('Transaction confirmation async lifecycle', () => {
    beforeEach(async () => {
        await cleanupDatabase();
        await resetAnvil();
        await confirmationQueueWorker.waitUntilReady();
    });

    it('should confirm transaction through BullMQ worker', async () => {
        const { app, token: adminToken } = await createAdminUser();

        try {
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

            /*
             * Submit the real blockchain transaction.
             *
             * TransferService is responsible for:
             *
             *   PENDING
             *      ↓
             *   blockchain submission
             *      ↓
             *   txHash persisted
             *      ↓
             *   SUBMITTED
             *      ↓
             *   confirmation job enqueued
             */
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
             * The confirmation job is already in BullMQ.
             *
             * Do not remove it and do not enqueue another job.
             * The real confirmation worker should process it.
             */

            const confirmed = await waitForTransactionStatus(transaction.id, 'CONFIRMED', 10_000);

            expect(confirmed).not.toBeNull();
            expect(confirmed?.status).toBe('CONFIRMED');

            expect(confirmed?.txHash).toBe(transaction.txHash);
            expect(confirmed?.confirmationStartedAt).not.toBeNull();
            expect(confirmed?.blockNumber).toBeDefined();
            expect(confirmed?.gasUsed).toBeDefined();
            expect(confirmed?.confirmedAt).not.toBeNull();
        } finally {
            await app.close();
        }
    });
});

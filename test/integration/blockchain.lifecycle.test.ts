import { describe, it, expect, beforeEach } from 'vitest';

import { cleanupDatabase } from '../helpers/cleanup.js';
import { createAdminUser, createAuthenticatedUser } from '../helpers/auth.js';

import { deployMiniUSDT } from '../helpers/deploy.js';

import {
waitForTransactionConfirmation,
waitForEventIndexing,
} from '../helpers/blockchain.helper.js';

import { ConfirmationWorker } from '../../src/workers/confirmation.worker.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';

import { prisma } from '../../src/database/prisma.js';

import { start as startEventListener } from '../../src/workers/event.listener.js';

import { randomUUID } from 'crypto';

import { createPublicClient, http } from 'viem';

import { resetAnvil } from '../helpers/anvil-reset.js';
import { ANVIL_ACCOUNTS } from '../helpers/anvil.js';

describe('Blockchain transaction lifecycle', () => {
    beforeEach(async () => {
        await cleanupDatabase();
        await resetAnvil();
    });

    // Both sender and receiver wallets come straight out of createAuthenticatedUser()
    // now — each has its own freshly generated, Anvil-funded custodial key attached,
    // with wallet.address guaranteed to match what that key actually signs with.
    // There's no need (and no longer any correct way) to hand-override the address
    // to a fixed ANVIL_WALLETS constant, since the transfer is signed server-side
    // via SignerService using whatever key is actually attached to the wallet.
    async function setupToken() {
        const { app, token: adminToken } = await createAdminUser();

        const senderContext = await createAuthenticatedUser({walletPrivateKey: ANVIL_ACCOUNTS.user});

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

        return {
            app,
            adminToken,
            senderContext,
            receiverContext,
            senderWallet: senderContext.wallet,
            receiverWallet: receiverContext.wallet,
            tokenId,
            tokenAddress,
        };
    }

    it('should complete mint and transfer lifecycle', async () => {
        const { app, adminToken, senderContext, senderWallet, receiverWallet, tokenId } =
            await setupToken();

        // Mint no longer takes a signer — the platform minter key is resolved
        // server-side (PRIVATE_KEY in env), and the mint route is admin-only.
        const mintResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/tokens/${tokenId}/mint`,
            headers: {
                authorization: `Bearer ${adminToken}`,
            },
            payload: {
                receiver: senderWallet.address,
                amount: '1000000000',
            },
        });

        expect(mintResponse.statusCode).toBe(200);

        await startEventListener(tokenId);

        const mintTransfers = await prisma.tokenTransfer.findMany({
            where: {
                tokenId,
            },
        });

        expect(mintTransfers.length).toBe(1);

        // Transfer no longer takes a signer either — fromWalletId identifies
        // which of the caller's wallets to send from, and SignerService
        // resolves the signing key server-side.
        const transferResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${senderContext.token}`,
            },
            payload: {
                tokenId,
                fromWalletId: senderWallet.id,
                toWalletId: receiverWallet.id,
                amount: '100',
            },
        });

        expect(transferResponse.statusCode).toBe(201);

        const transaction = transferResponse.json().data;

        const confirmationWorker = new ConfirmationWorker(new TransactionRepository());

        await confirmationWorker.process();

        const confirmed = await waitForTransactionConfirmation(transaction.id);

        const publicClient = createPublicClient({
            transport: http(process.env.RPC_URL),
        });
        await publicClient.getBlockNumber();

        expect(confirmed.status).toBe('CONFIRMED');

        expect(confirmed.txHash).toBeTruthy();

        await new Promise((resolve) => setTimeout(resolve, 100));

        await waitForEventIndexing(tokenId, 2);

        const senderBalance = await prisma.balanceSnapshot.findUnique({
            where: {
                walletId_tokenId: {
                    walletId: senderWallet.id,
                    tokenId,
                },
            },
        });

        const receiverBalance = await prisma.balanceSnapshot.findUnique({
            where: {
                walletId_tokenId: {
                    walletId: receiverWallet.id,
                    tokenId,
                },
            },
        });

        expect(senderBalance?.balance).toBe(900000000n);

        expect(receiverBalance?.balance).toBe(100000000n);

        await app.close();
    });

    it('should mark transaction FAILED when sender has insufficient balance', async () => {
        const { app, senderContext, senderWallet, receiverWallet, tokenId } = await setupToken();

        const transferResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${senderContext.token}`,
            },
            payload: {
                tokenId,
                fromWalletId: senderWallet.id,
                toWalletId: receiverWallet.id,
                amount: '999999999999',
            },
        });

        expect(transferResponse.statusCode).toBe(201);

        const transaction = transferResponse.json().data;

        const worker = new ConfirmationWorker(new TransactionRepository());

        await worker.process();

        await waitForTransactionConfirmation(transaction.id);

        expect(transaction.status).toBe('FAILED');

        expect(transaction.failureReason).toContain('ERC20InsufficientBalance');

        const receiverBalance = await prisma.balanceSnapshot.findFirst({
            where: {
                walletId: receiverWallet.id,
                tokenId,
            },
        });

        expect(receiverBalance).toBeNull();

        const transfers = await prisma.tokenTransfer.findMany({
            where: {
                tokenId,
            },
        });

        expect(transfers.length).toBe(0);

        await app.close();
    });

    it('should not duplicate transfer events when listener runs twice', async () => {
        const { app, adminToken, senderWallet, tokenId } = await setupToken();

        await app.inject({
            method: 'POST',
            url: `/api/v1/tokens/${tokenId}/mint`,
            headers: {
                authorization: `Bearer ${adminToken}`,
            },
            payload: {
                receiver: senderWallet.address,
                amount: '1000',
            },
        });

        await startEventListener(tokenId);

        const firstRun = await prisma.tokenTransfer.count({
            where: {
                tokenId,
            },
        });

        expect(firstRun).toBe(1);

        await startEventListener(tokenId);

        const secondRun = await prisma.tokenTransfer.count({
            where: {
                tokenId,
            },
        });

        expect(secondRun).toBe(1);

        await app.close();
    });
});

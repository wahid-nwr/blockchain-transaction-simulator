import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cleanupDatabase } from '../helpers/cleanup.js';
import { createAdminUser, createAuthenticatedUser } from '../helpers/auth.js';

import { deployMiniUSDT } from '../helpers/deploy.js';

import {
    waitForTransactionConfirmation,
    waitForEventIndexing,
} from '../helpers/blockchain.helper.js';

import { ANVIL_WALLETS } from '../helpers/anvil-wallet.js';

vi.mock('../../src/blockchain/rpc.instrumentation.js', () => ({
    instrumentRpc: vi.fn(async (_method: string, fn: () => Promise<unknown>) => fn()),
}));
import { ConfirmationWorker } from '../../src/workers/confirmation.worker.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';

import { prisma } from '../../src/database/prisma.js';

import { start as startEventListener } from '../../src/workers/event.listener.js';

import { randomUUID } from 'crypto';

import { ANVIL_ACCOUNTS } from '../helpers/anvil.js';

import { createPublicClient, http } from 'viem';

import { resetAnvil } from '../helpers/anvil-reset.js';

describe('Blockchain transaction lifecycle', () => {
    const deployerSigner = {
        address: ANVIL_WALLETS.deployer,
        privateKey: ANVIL_ACCOUNTS.deployer,
    };

    const userSigner = {
        address: ANVIL_WALLETS.user,
        privateKey: ANVIL_ACCOUNTS.user,
    };

    beforeEach(async () => {
        await cleanupDatabase();
        await resetAnvil();
    });

    async function setupToken() {
        const { app, token: adminToken } = await createAdminUser();

        const senderContext = await createAuthenticatedUser();

        const receiverContext = await createAuthenticatedUser();

        const senderWallet = await prisma.wallet.update({
            where: {
                id: senderContext.wallet.id,
            },
            data: {
                address: ANVIL_WALLETS.user.toLowerCase(),
            },
        });

        const receiverWallet = await prisma.wallet.update({
            where: {
                id: receiverContext.wallet.id,
            },
            data: {
                address: ANVIL_WALLETS.receiver.toLowerCase(),
            },
        });

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
            senderWallet,
            receiverWallet,
            tokenId,
            tokenAddress,
        };
    }

    it('should complete mint and transfer lifecycle', async () => {
        const { app, adminToken, senderContext, senderWallet, receiverWallet, tokenId } =
            await setupToken();

        const mintResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/tokens/${tokenId}/mint`,
            headers: {
                authorization: `Bearer ${adminToken}`,
            },
            payload: {
                receiver: senderWallet.address,
                amount: '1000000000',
                signer: deployerSigner,
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

        const transferResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${senderContext.token}`,
            },
            payload: {
                tokenId,
                toWalletId: receiverWallet.id,
                amount: '100',
                signer: userSigner,
            },
        });

        expect(transferResponse.statusCode).toBe(201);

        const transaction = transferResponse.json().data;

        const confirmationWorker = new ConfirmationWorker(new TransactionRepository());

        await confirmationWorker.process();

        const confirmed = await waitForTransactionConfirmation(transaction.id);

        console.log('CONFIRM RESULT', confirmed);
        const publicClient = createPublicClient({
            transport: http(process.env.RPC_URL),
        });
        const currentBlock = await publicClient.getBlockNumber();

        console.log('CHAIN STATE', {
            confirmedBlock: confirmed.blockNumber,
            currentBlock,
        });

        expect(confirmed.status).toBe('CONFIRMED');

        expect(confirmed.txHash).toBeTruthy();

        await new Promise((resolve) => setTimeout(resolve, 100));

        const tokenBeforeIndex = await prisma.token.findUnique({
            where: {
                id: tokenId,
            },
        });

        console.log('TOKEN CURSOR BEFORE INDEX', {
            lastProcessedBlock: tokenBeforeIndex?.lastProcessedBlock,
            confirmedBlock: confirmed.blockNumber,
        });

        await waitForEventIndexing(tokenId, 2);

        const transfers = await prisma.tokenTransfer.findMany({
            orderBy: {
                createdAt: 'asc',
            },
        });

        console.log(
            'TOKEN TRANSFERS',
            transfers.map((t) => ({
                from: t.from,
                to: t.to,
                amount: t.amount,
                txHash: t.transactionHash,
                block: t.blockNumber,
            })),
        );

        const snapshots = await prisma.balanceSnapshot.findMany({
            orderBy: {
                updatedAt: 'asc',
            },
        });

        console.log(
            'BALANCE SNAPSHOTS',
            snapshots.map((s) => ({
                walletId: s.walletId,
                balance: s.balance,
                tokenId: s.tokenId,
            })),
        );
        /*const balances = await prisma.balanceSnapshot.findMany({
            where: {
                tokenId,
            },
        });

        const senderBalance = balances.find((b) => b.walletId === senderWallet.id);

        const receiverBalance = balances.find((b) => b.walletId === receiverWallet.id);*/

        /*await startEventListener(tokenId);*/
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
        const { app, senderContext, receiverWallet, tokenId } = await setupToken();

        const transferResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${senderContext.token}`,
            },
            payload: {
                tokenId,
                toWalletId: receiverWallet.id,
                amount: '999999999999',
                signer: userSigner,
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
                signer: deployerSigner,
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

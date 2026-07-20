import { describe, it, expect, beforeEach } from 'vitest';

import { cleanupDatabase } from '../helpers/cleanup.js';
import { createAdminUser, createAuthenticatedUser } from '../helpers/auth.js';

import { deployMiniUSDT } from '../helpers/deploy.js';

import { waitForTransactionConfirmation } from '../helpers/blockchain.helper.js';

import { ANVIL_WALLETS } from '../helpers/anvil-wallet.js';

import { ConfirmationWorker } from '../../src/workers/confirmation.worker.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';

import { prisma } from '../../src/database/prisma.js';

import { start as startEventListener } from '../../src/workers/event.listener.js';

import { randomUUID } from 'crypto';

import { publicClient } from '../../src/blockchain/client.js';

import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };
import { ANVIL_ACCOUNTS } from '../helpers/anvil.js';

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
    });

    it('should complete mint and transfer lifecycle', async () => {
        const { app, token: adminToken } = await createAdminUser();

        //
        // Users
        //

        const senderContext = await createAuthenticatedUser();

        const receiverContext = await createAuthenticatedUser();

        //
        // Replace generated wallets with Anvil wallets
        //

        const senderWallet = await prisma.wallet.update({
            where: {
                id: senderContext.wallet.id,
            },
            data: {
                address: ANVIL_WALLETS.user,
            },
        });

        const receiverWallet = await prisma.wallet.update({
            where: {
                id: receiverContext.wallet.id,
            },
            data: {
                address: ANVIL_WALLETS.receiver,
            },
        });

        //
        // Deploy contract
        //

        const tokenAddress = await deployMiniUSDT();

        const code = await publicClient.getCode({
            address: tokenAddress as `0x${string}`,
        });

        expect(code).toBeTruthy();

        const name = await publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: MiniUSDTAbi.abi,
            functionName: 'name',
        });

        const symbol = await publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: MiniUSDTAbi.abi,
            functionName: 'symbol',
        });

        expect(name).toBe('Mini Tether USD');

        expect(symbol).toBe('mUSDT');

        //
        // Register token
        //

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

        //
        // Mint
        //

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

        //
        // Index mint event
        //

        await startEventListener(tokenAddress);

        //
        // Transfer
        //

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

        //
        // Confirm blockchain transaction
        //

        const worker = new ConfirmationWorker(new TransactionRepository());

        await worker.process();

        //
        // Index transfer event
        //

        await startEventListener(tokenAddress);

        const confirmed = await waitForTransactionConfirmation(transaction.id);

        expect(confirmed.status).toBe('CONFIRMED');

        //
        // Validate balances
        //

        const balances = await prisma.balanceSnapshot.findMany({
            where: {
                tokenId,
            },
        });

        const senderBalance = balances.find((b) => b.walletId === senderWallet.id);

        const receiverBalance = balances.find((b) => b.walletId === receiverWallet.id);

        expect(senderBalance).toBeTruthy();

        expect(receiverBalance).toBeTruthy();

        expect(senderBalance!.balance).toBe(900000000n);

        expect(receiverBalance!.balance).toBe(100000000n);

        await app.close();
    });
});

import { describe, it, vi, expect } from 'vitest';

vi.setConfig({
    testTimeout: 10000,
});

import { createAuthenticatedUser } from '../helpers/auth.js';
import { createTestApp } from '../helpers/app.js';
import { ANVIL_ACCOUNTS } from '../helpers/anvil.js';
import { createWallet, createCustodialWallet } from '../factories/wallet.factory.js';
import { createToken } from '../factories/token.factory.js';

describe('Transaction API', () => {
    async function createTransaction(app: any, token: string, user: any, wallet: any) {
        const anvilToken = await createToken();

        const receiver = await createWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
            chainId: 31337,
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                tokenId: anvilToken.id,
                fromWalletId: wallet.id,
                toWalletId: receiver.id,
                amount: '500000',
            },
        });

        expect(response.statusCode).toBe(201);

        return response.json().data;
    }

    it('creates a pending transaction', async () => {
        const { app, token, user, wallet } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const transaction = await createTransaction(app, token, user, wallet);

        expect(transaction.status).toBe('PENDING');
        expect(transaction.fromWalletId).toBe(wallet.id);

        await app.close();
    });

    it('lists transactions', async () => {
        const { app, token } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().data).toBeInstanceOf(Array);

        await app.close();
    });

    it('gets transaction by id', async () => {
        const { app, token, user, wallet } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const transaction = await createTransaction(app, token, user, wallet);

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/transactions/${transaction.id}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().data.id).toBe(transaction.id);

        await app.close();
    });

    it('rejects transaction access from another tenant', async () => {
        const tenantA = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const transaction = await createTransaction(
            tenantA.app,
            tenantA.token,
            tenantA.user,
            tenantA.wallet,
        );

        const tenantB = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const response = await tenantB.app.inject({
            method: 'GET',
            url: `/api/v1/transactions/${transaction.id}`,
            headers: {
                authorization: `Bearer ${tenantB.token}`,
            },
        });

        expect(response.statusCode).toBe(404);

        await tenantA.app.close();
        await tenantB.app.close();
    });

    it('returns 404 for unknown transaction id', async () => {
        const { app, token } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/transactions/00000000-0000-0000-0000-000000000000',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(404);

        await app.close();
    });

    it('rejects missing jwt', async () => {
        const app = await createTestApp({
            disableWorkers: true,
        });

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/transactions',
        });

        expect(response.statusCode).toBe(401);

        await app.close();
    });

    it('rejects invalid transaction payload', async () => {
        const { app, token } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                amount: '1000000',
            },
        });

        expect(response.statusCode).toBe(400);

        await app.close();
    });

    it('rejects zero transfer amount', async () => {
        const { app, token, user, wallet } = await createAuthenticatedUser({
            disableWorkers: true,
        });
        const tokenRecord = await createToken();

        const receiver = await createWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
            chainId: 31337,
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        });
        const payload = {
            tokenId: tokenRecord.id,
            fromWalletId: wallet.id,
            toWalletId: receiver.id,
            amount: '0',
        };
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload,
        });

        expect(response.statusCode).toBe(400);

        await app.close();
    });

    it('rejects a payload with an invalid fromWalletId', async () => {
        const { app, token } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                tokenId: 'token-id',
                fromWalletId: 'not-a-uuid',
                toWalletId: 'wallet-id',
                amount: '1000',
            },
        });

        expect(response.statusCode).toBe(400);

        await app.close();
    });

    it('rejects negative transfer amount', async () => {
        const { app, token, wallet } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                tokenId: 'token-id',
                fromWalletId: wallet.id,
                toWalletId: 'wallet-id',
                amount: '-100',
            },
        });

        expect(response.statusCode).toBe(400);

        await app.close();
    });

    it('rejects transaction with unknown token', async () => {
        const { app, token, wallet } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                tokenId: '00000000-0000-4000-8000-000000000001',
                fromWalletId: wallet.id,
                toWalletId: wallet.id,
                amount: '1000',
            },
        });

        expect(response.statusCode).toBe(404);

        await app.close();
    });

    it('rejects sending from a wallet owned by someone else', async () => {
        const owner = await createAuthenticatedUser({ disableWorkers: true });
        const attacker = await createAuthenticatedUser({ disableWorkers: true });
        const tokenRecord = await createToken();

        const receiver = await createWallet({
            tenantId: attacker.user.tenantId,
            ownerId: attacker.user.id,
            chainId: 31337,
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        });

        // attacker tries to submit a transfer using owner's wallet id as fromWalletId
        const response = await attacker.app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${attacker.token}`,
            },
            payload: {
                tokenId: tokenRecord.id,
                fromWalletId: owner.wallet.id,
                toWalletId: receiver.id,
                amount: '1000',
            },
        });

        expect(response.statusCode).toBe(404);

        await owner.app.close();
        await attacker.app.close();
    });

    it('rejects a transfer from a non-custodial (EXTERNAL) wallet', async () => {
        const { app, token, user } = await createAuthenticatedUser({ disableWorkers: true });
        const tokenRecord = await createToken();

        // EXTERNAL: no private key held server-side, so it can never be signed for here
        const externalWallet = await createWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
            chainId: 31337,
        });

        const receiver = await createWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
            chainId: 31337,
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                tokenId: tokenRecord.id,
                fromWalletId: externalWallet.id,
                toWalletId: receiver.id,
                amount: '1000',
            },
        });

        // request is well-formed and authorized, but the ledger records the
        // failure rather than the request 500ing — matches TransferService's
        // catch-and-mark-failed behavior for any post-createPending error.
        expect(response.statusCode).toBe(201);
        expect(response.json().data.status).toBe('FAILED');

        await app.close();
    });

    it('allows a second custodial wallet, distinct from the default one, to sign', async () => {
        const { app, token, user } = await createAuthenticatedUser({ disableWorkers: true });
        const tokenRecord = await createToken();

        const secondWallet = await createCustodialWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
            chainId: 31337,
            privateKey: ANVIL_ACCOUNTS.receiver,
        });

        const receiver = await createWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
            chainId: 31337,
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                tokenId: tokenRecord.id,
                fromWalletId: secondWallet.id,
                toWalletId: receiver.id,
                amount: '1000',
            },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json().data.fromWalletId).toBe(secondWallet.id);

        await app.close();
    });

    /*it('rejects invalid pagination parameters', async () => {
        const { app, token } = await createAuthenticatedUser({
            disableWorkers: true,
        });

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/transactions?page=abc&limit=-10',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(400);

        await app.close();
    });*/
});

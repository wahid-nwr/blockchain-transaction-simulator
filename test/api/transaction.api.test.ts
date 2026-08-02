import { describe, it, vi, expect } from 'vitest';

vi.setConfig({
    testTimeout: 10000,
});

import { createAuthenticatedUser } from '../helpers/auth.js';
import { createTestApp } from '../helpers/app.js';
import { createWallet } from '../factories/wallet.factory.js';
import { createToken } from '../factories/token.factory.js';
import { ANVIL_ACCOUNTS } from '../helpers/anvil.js';

describe('Transaction API', () => {
    async function createTransaction(app: any, token: string, user: any, wallet: any) {
        const anvilToken = await createToken();

        console.log('TEST TOKEN', anvilToken.id);

        const receiver = await createWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
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
                signer: {
                    address: wallet.address,
                    privateKey: ANVIL_ACCOUNTS.user,
                },
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

        console.log(transaction);

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
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        });
        const payload = {
            tokenId: tokenRecord.id,
            toWalletId: receiver.id,
            amount: '0',
            signer: {
                address: wallet.address,
                privateKey: ANVIL_ACCOUNTS.user,
            },
        };
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: payload,
        });

        expect(response.statusCode).toBe(400);

        await app.close();
    });

    it('rejects invalid signer payload', async () => {
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
                toWalletId: 'wallet-id',
                amount: '1000',
                signer: {
                    address: 'invalid-address',
                    privateKey: 'invalid-key',
                },
            },
        });

        expect(response.statusCode).toBe(400);

        await app.close();
    });

    it('rejects negative transfer amount', async () => {
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
                toWalletId: 'wallet-id',
                amount: '-100',
                signer: {
                    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                    privateKey: ANVIL_ACCOUNTS.user,
                },
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
                toWalletId: wallet.id,
                amount: '1000',
                signer: {
                    address: wallet.address,
                    privateKey: ANVIL_ACCOUNTS.user,
                },
            },
        });

        expect(response.statusCode).toBe(404);

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

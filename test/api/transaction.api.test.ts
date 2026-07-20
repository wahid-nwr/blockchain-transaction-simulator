import { describe, it, expect } from 'vitest';
import { createAuthenticatedUser } from '../helpers/auth.js';
import { createTestApp } from '../helpers/app.js';
import { createWallet } from '../factories/wallet.factory.js';
import { createToken } from '../factories/token.factory.js';
import { ANVIL_ACCOUNTS } from '../helpers/anvil.js';

describe('Transaction API', () => {
    it('creates a pending transaction', async () => {
        const { app, token, user, wallet } = await createAuthenticatedUser();

        const anvilToken = await createToken();

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
                amount: '1000000',
                signer: {
                    address: wallet.address,
                    privateKey: ANVIL_ACCOUNTS.user,
                },
            },
        });

        expect(response.statusCode).toBe(201);

        const body = response.json();

        expect(body.data.status).toBe('PENDING');

        expect(body.data.fromWalletId).toBe(wallet.id);

        expect(body.data.toWalletId).toBe(receiver.id);

        await app.close();
    });

    it('lists transactions', async () => {
        const { app, token } = await createAuthenticatedUser();

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
        const { app, token, user, wallet } = await createAuthenticatedUser();

        const anvilToken = await createToken();

        const receiver = await createWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        });

        const createResponse = await app.inject({
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

        expect(createResponse.statusCode).toBe(201);

        const transactionId = createResponse.json().data.id;

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/transactions/${transactionId}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        expect(response.json().data.id).toBe(transactionId);

        await app.close();
    });

    it('rejects missing jwt', async () => {
        const app = await createTestApp();

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/transactions',
        });

        expect(response.statusCode).toBe(401);

        await app.close();
    });
});

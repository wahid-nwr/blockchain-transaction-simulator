import { describe, it, expect } from 'vitest';

import { createAdminUser, createAuthenticatedUser } from '../helpers/auth.js';
import { randomUUID } from 'crypto';
import { createBalanceSnapshot } from '../factories/balance-snapshot.factory.js';

describe('Token API', () => {
    const tokenPayload = {
        tokenId: randomUUID(),
        name: 'Mini USDT',
        symbol: 'USDT',
        decimals: 6,
        contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    };

    it('registers token as admin', async () => {
        const { app, token } = await createAdminUser();

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/tokens',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                tokenId: randomUUID(),
                name: 'Mini USDT',
                symbol: 'USDT',
                decimals: 6,
                contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
            },
        });

        expect(response.statusCode).toBe(201);

        const body = response.json();

        expect(body.data).toHaveProperty('id');

        expect(body.data.symbol).toBe('USDT');
    });

    it('lists tokens for admin', async () => {
        const { app, token } = await createAdminUser();

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/tokens',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(Array.isArray(body.data)).toBe(true);
    });

    it('gets token by id', async () => {
        const { app, token } = await createAdminUser();

        const create = await app.inject({
            method: 'POST',
            url: '/api/v1/tokens',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                tokenId: randomUUID(),
                name: 'Mini USDT',
                symbol: 'USDT',
                decimals: 6,
                contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
            },
        });

        const created = create.json();

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tokens/${created.data.id}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        expect(response.json().data.id).toBe(created.data.id);
    });

    it('rejects missing jwt', async () => {
        const { app } = await createAdminUser();

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/tokens',
        });

        expect(response.statusCode).toBe(401);

        await app.close();
    });

    it('rejects token access for normal user', async () => {
        const { app, token } = await createAuthenticatedUser();

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/tokens',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(403);

        await app.close();
    });

    it('gets wallet token balance', async () => {
        const { app, token, wallet } = await createAuthenticatedUser();

        const admin = await createAdminUser();

        const createToken = await admin.app.inject({
            method: 'POST',
            url: '/api/v1/tokens',
            headers: {
                authorization: `Bearer ${admin.token}`,
            },
            payload: tokenPayload,
        });

        const createdToken = createToken.json().data;

        console.log(createdToken);
        console.log(wallet);
        await createBalanceSnapshot({
            walletId: wallet.id,
            tokenId: createdToken.id,
            balance: BigInt(1000000),
            blockNumber: BigInt(1),
        });

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tokens/${createdToken.id}/balance/${wallet.id}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.data.walletId).toBe(wallet.id);

        expect(body.data.tokenId).toBe(createdToken.id);

        await app.close();
        await admin.app.close();
    });
});

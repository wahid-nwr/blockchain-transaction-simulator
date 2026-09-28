import { describe, it, expect, vi } from 'vitest';

import { createAdminUser, createAuthenticatedUser } from '../helpers/auth.js';
import { randomUUID } from 'crypto';
import { createBalanceSnapshot } from '../factories/balance-snapshot.factory.js';
import { publicClient } from '../../src/blockchain/client.js';

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

    it('reconciles a matching wallet token balance', async () => {
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

        await createBalanceSnapshot({
            walletId: wallet.id,
            tokenId: createdToken.id,
            balance: 1000000n,
            blockNumber: 10n,
        });

        const readContract = vi
            .spyOn(publicClient, 'readContract')
            .mockResolvedValue(1000000n as never);

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tokens/${createdToken.id}/balance/${wallet.id}/reconcile?blockNumber=10`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        console.log(response.statusCode, response.body);
        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.data.status).toBe('MATCH');

        expect(body.data.walletId).toBe(wallet.id);
        expect(body.data.tokenId).toBe(createdToken.id);

        expect(body.data.persisted).toEqual({
            balance: '1000000',
            blockNumber: '10',
        });

        expect(body.data.chain).toEqual({
            balance: '1000000',
            blockNumber: '10',
        });

        expect(readContract).toHaveBeenCalledOnce();

        readContract.mockRestore();

        await app.close();
        await admin.app.close();
    });

    it('detects a balance mismatch without modifying the persisted snapshot', async () => {
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

        await createBalanceSnapshot({
            walletId: wallet.id,
            tokenId: createdToken.id,
            balance: 1000000n,
            blockNumber: 10n,
        });

        const readContract = vi
            .spyOn(publicClient, 'readContract')
            .mockResolvedValue(900000n as never);

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tokens/${createdToken.id}/balance/${wallet.id}/reconcile?blockNumber=10`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.data.status).toBe('MISMATCH');

        expect(body.data.persisted).toEqual({
            balance: '1000000',
            blockNumber: '10',
        });

        expect(body.data.chain).toEqual({
            balance: '900000',
            blockNumber: '10',
        });

        // The reconciliation endpoint must be read-only.
        const balanceResponse = await app.inject({
            method: 'GET',
            url: `/api/v1/tokens/${createdToken.id}/balance/${wallet.id}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(balanceResponse.statusCode).toBe(200);

        expect(balanceResponse.json().data.balance).toBe('1000000');

        readContract.mockRestore();

        await app.close();
        await admin.app.close();
    });

    it('reports a stale chain observation without changing the persisted snapshot', async () => {
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

        await createBalanceSnapshot({
            walletId: wallet.id,
            tokenId: createdToken.id,
            balance: 1000000n,
            blockNumber: 20n,
        });

        const readContract = vi
            .spyOn(publicClient, 'readContract')
            .mockResolvedValue(1000000n as never);

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/tokens/${createdToken.id}/balance/${wallet.id}/reconcile?blockNumber=10`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.data.status).toBe('STALE_OBSERVATION');

        expect(body.data.persisted).toEqual({
            balance: '1000000',
            blockNumber: '20',
        });

        expect(body.data.chain).toEqual({
            balance: '1000000',
            blockNumber: '10',
        });

        const balanceResponse = await app.inject({
            method: 'GET',
            url: `/api/v1/tokens/${createdToken.id}/balance/${wallet.id}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(balanceResponse.statusCode).toBe(200);

        expect(balanceResponse.json().data.balance).toBe('1000000');

        readContract.mockRestore();

        await app.close();
        await admin.app.close();
    });
});

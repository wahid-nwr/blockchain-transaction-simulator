import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/app.js';
import { createAuthenticatedUser } from '../helpers/auth.js';
import { fundAccount } from '../helpers/anvil.js';
import { createToken } from '../factories/token.factory.js';
import { createWallet } from '../factories/wallet.factory.js';
import { prisma } from '../../src/database/prisma.js';
import { decryptWalletKey } from '../../src/crypto/envelope.js';
import { privateKeyToAccount } from 'viem/accounts';

describe('Wallet API', () => {
    it('gets current user identity', async () => {
        const { app, token, user } = await createAuthenticatedUser();

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/wallets/me',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.data.userId).toBe(user.id);

        expect(body.data.email).toBe(user.email);

        await app.close();
    });

    it("gets current user's wallets", async () => {
        const app = await createTestApp();

        const { token, wallet } = await createAuthenticatedUser();

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/wallets',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.data.length).toBeGreaterThan(0);

        expect(body.data.some((w: any) => w.id === wallet.id)).toBe(true);

        await app.close();
    });

    it('rejects missing jwt', async () => {
        const app = await createTestApp();

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/wallets',
        });

        expect(response.statusCode).toBe(401);

        await app.close();
    });

    it('creates wallet', async () => {
        const { app, token } = await createAuthenticatedUser();

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/wallets',
            headers: {
                authorization: `Bearer ${token}`,
            },
            payload: {
                address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                chainId: 31337,
            },
        });

        expect(response.statusCode).toBe(201);

        expect(response.json().data.address).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');

        await app.close();
    });

    it('gets wallet by id', async () => {
        const { app, token, wallet } = await createAuthenticatedUser();

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/wallets/${wallet.id}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);

        expect(response.json().data.id).toBe(wallet.id);

        await app.close();
    });
});

describe('Custodial wallet API', () => {
    async function createCustodial(app: any, token: string, payload: unknown) {
        return app.inject({
            method: 'POST',
            url: '/api/v1/wallets/custodial',
            headers: { authorization: `Bearer ${token}` },
            payload,
        });
    }

    it('creates a custodial wallet owned by the caller and stores only an encrypted key', async () => {
        const { app, token, user } = await createAuthenticatedUser({ disableWorkers: true });

        const response = await createCustodial(app, token, { chainId: 31337 });

        expect(response.statusCode).toBe(201);

        const wallet = response.json().data;

        expect(wallet.custodyType).toBe('CUSTODIAL');
        expect(wallet.ownerId).toBe(user.id);
        expect(wallet.tenantId).toBe(user.tenantId);
        expect(wallet.chainId).toBe(31337);
        expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/);

        // No key material anywhere in the response.
        expect(response.body).not.toMatch(/custodyKey|encryptedKey|privateKey|secret/i);

        // The key row exists and decrypts to the key behind the address.
        const keyRow = await prisma.walletCustodyKey.findUnique({ where: { walletId: wallet.id } });
        expect(keyRow).not.toBeNull();

        const secret = await decryptWalletKey(keyRow!.encryptedKey, keyRow!.kmsKeyId);
        expect(privateKeyToAccount(secret as `0x${string}`).address.toLowerCase()).toBe(
            wallet.address,
        );

        await app.close();
    });

    it('creates a wallet the platform can actually sign a transfer from', async () => {
        const { app, token, user } = await createAuthenticatedUser({ disableWorkers: true });

        const created = (await createCustodial(app, token, { chainId: 31337 })).json().data;

        // A fresh keypair has no ETH for gas on Anvil.
        await fundAccount(created.address);

        const tokenRecord = await createToken();
        const receiver = await createWallet({
            tenantId: user.tenantId,
            ownerId: user.id,
            chainId: 31337,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/transactions',
            headers: { authorization: `Bearer ${token}` },
            payload: {
                tokenId: tokenRecord.id,
                fromWalletId: created.id,
                toWalletId: receiver.id,
                amount: '1000',
            },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json().data.status).toBe('SUBMITTED');

        await app.close();
    });

    it('rejects a chainId the deployment has no chain for', async () => {
        const { app, token } = await createAuthenticatedUser({ disableWorkers: true });

        const response = await createCustodial(app, token, { chainId: 1 });

        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('UNSUPPORTED_CHAIN');

        await app.close();
    });

    it('rejects Bitcoin, whose custody is delegated to the node wallet', async () => {
        const { app, token } = await createAuthenticatedUser({ disableWorkers: true });

        const response = await createCustodial(app, token, { chainId: 18444 });

        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('UNSUPPORTED_CHAIN_CAPABILITY');

        await app.close();
    });

    it('rejects a body without a chainId', async () => {
        const { app, token } = await createAuthenticatedUser({ disableWorkers: true });

        const response = await createCustodial(app, token, {});

        expect(response.statusCode).toBe(400);

        await app.close();
    });

    it('rejects a missing jwt', async () => {
        const { app } = await createAuthenticatedUser({ disableWorkers: true });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/wallets/custodial',
            payload: { chainId: 31337 },
        });

        expect(response.statusCode).toBe(401);

        await app.close();
    });
});

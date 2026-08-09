import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

import { cleanupDatabase } from '../helpers/cleanup.js';
import { createAdminUser, createAuthenticatedUser } from '../helpers/auth.js';

import { deployMiniUSDT } from '../helpers/deploy.js';
import { start as startEventListener } from '../../src/workers/event.listener.js';

import { prisma } from '../../src/database/prisma.js';

describe('Event listener idempotency', () => {
    beforeEach(async () => {
        await cleanupDatabase();
    });

    it('should not insert duplicate transfer events', async () => {
        const { app, token: adminToken } = await createAdminUser();

        // createAuthenticatedUser already attaches a real, Anvil-funded
        // custodial key whose derived address matches wallet.address — no
        // need to overwrite it to a fixed ANVIL_WALLETS constant anymore.
        const user = await createAuthenticatedUser();
        const wallet = user.wallet;

        const tokenAddress = await deployMiniUSDT();

        const tokenResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/tokens',
            headers: {
                authorization: `Bearer ${adminToken}`,
            },
            payload: {
                tokenId: crypto.randomUUID(),
                name: 'MiniUSDT',
                symbol: 'USDT',
                contractAddress: tokenAddress,
            },
        });

        const tokenId = tokenResponse.json().data.id;

        // Mint no longer takes a signer — the platform minter key (PRIVATE_KEY
        // in env) is resolved server-side, and the route is admin-only.
        await app.inject({
            method: 'POST',
            url: `/api/v1/tokens/${tokenId}/mint`,
            headers: {
                authorization: `Bearer ${adminToken}`,
            },
            payload: {
                receiver: wallet.address,
                amount: '1000',
            },
        });

        //
        // First scan
        //

        await startEventListener(tokenId);

        const firstRun = await prisma.tokenTransfer.findMany({
            where: {
                tokenId,
            },
        });

        expect(firstRun.length).toBe(1);

        //
        // Second scan
        //

        await startEventListener(tokenId);

        const secondRun = await prisma.tokenTransfer.findMany({
            where: {
                tokenId,
            },
        });

        expect(secondRun.length).toBe(1);

        await app.close();
    });
});

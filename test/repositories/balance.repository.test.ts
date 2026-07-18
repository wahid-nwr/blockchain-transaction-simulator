import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { BalanceRepository } from '../../src/repositories/balance.repository.js';
import { prisma } from '../../src/database/prisma.js';

import { cleanupDatabase } from '../helpers/cleanup.js';
import { createTenant } from '../factories/tenant.factory.js';
import { createUser } from '../factories/user.factory.js';
import { createWallet } from '../factories/wallet.factory.js';
import { createToken } from '../factories/token.factory.js';

describe('BalanceRepository', () => {
    const repository = new BalanceRepository();

    let tenant: any;
    let user: any;
    let wallet: any;
    let token: any;

    beforeEach(async () => {
        /*await cleanupDatabase();*/
        tenant = await createTenant();
        user = await createUser({
            tenant,
        });
        wallet = await createWallet({
            tenantId: tenant.id,
            ownerId: user.id,
        });
        token = await createToken();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('should create balance snapshot', async () => {
        const result = await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 5000n,
            blockNumber: 100n,
        });

        expect(result.balance).toBe(5000n);

        expect(result.blockNumber).toBe(100n);
    });

    it('should update existing balance snapshot', async () => {
        await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 1000n,
            blockNumber: 100n,
        });

        const result = await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 9000n,
            blockNumber: 200n,
        });

        expect(result.balance).toBe(9000n);

        expect(result.blockNumber).toBe(200n);
    });

    it('should find balance by wallet and token', async () => {
        await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 7000n,
            blockNumber: 300n,
        });

        const result = await repository.find(wallet.id, token.id);

        expect(result).not.toBeNull();

        expect(result?.balance).toBe(7000n);
    });

    it('should find balances by wallet', async () => {
        const token2 = await createToken({
            symbol: 'USDC',
        });

        await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 1000n,
            blockNumber: 100n,
        });

        await repository.upsert({
            walletId: wallet.id,
            tokenId: token2.id,
            balance: 2000n,
            blockNumber: 100n,
        });

        const result = await repository.findByWallet(wallet.id);

        expect(result).toHaveLength(2);

        expect(result[0].token).toBeDefined();
    });
});

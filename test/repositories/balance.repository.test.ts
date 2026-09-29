import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { BalanceRepository } from '../../src/repositories/balance.repository.js';
import { prisma } from '../../src/database/prisma.js';

import { createTenant } from '../factories/tenant.factory.js';
import { createUser } from '../factories/user.factory.js';
import { createWallet } from '../factories/wallet.factory.js';
import { createToken } from '../factories/token.factory.js';

describe('BalanceRepository', () => {
    const repository = new BalanceRepository();

    let tenantContainer: any;
    let tenant: any;
    let user: any;
    let wallet: any;
    let token: any;

    beforeEach(async () => {
        /*await cleanupDatabase();*/
        tenantContainer = await createTenant();
        tenant = tenantContainer.tenant;
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

    it('should not move a snapshot backwards when an older block is replayed', async () => {
        await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 9000n,
            blockNumber: 200n,
        });

        const result = await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 10000n,
            blockNumber: 100n,
        });

        expect(result.balance).toBe(9000n);
        expect(result.blockNumber).toBe(200n);
    });

    it('should not replace a snapshot at the same block', async () => {
        await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 9000n,
            blockNumber: 200n,
        });

        const result = await repository.upsert({
            walletId: wallet.id,
            tokenId: token.id,
            balance: 10000n,
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

    describe('findPageForReconciliation', () => {
        it('returns the wallet and token fields the drift sweep needs to read the chain', async () => {
            await repository.upsert({
                walletId: wallet.id,
                tokenId: token.id,
                balance: 1000n,
                blockNumber: 100n,
            });

            const [row] = await repository.findPageForReconciliation(undefined, 10);

            expect(row.walletId).toBe(wallet.id);
            expect(row.tokenId).toBe(token.id);
            expect(row.wallet).toEqual({ address: wallet.address, chainId: wallet.chainId });
            expect(row.token).toEqual({
                blockchain: token.blockchain,
                contractAddress: token.contractAddress,
                symbol: token.symbol,
            });
        });

        // The event listener indexes every token, active or not, so an inactive
        // token's snapshots keep moving and must still be checked for drift.
        it('includes snapshots of inactive tokens', async () => {
            await repository.upsert({
                walletId: wallet.id,
                tokenId: token.id,
                balance: 1000n,
                blockNumber: 100n,
            });

            await prisma.token.update({ where: { id: token.id }, data: { isActive: false } });

            const rows = await repository.findPageForReconciliation(undefined, 10);

            expect(rows.map((row) => row.tokenId)).toContain(token.id);
        });

        it('pages by id without gaps or overlap', async () => {
            const extraWallets = await Promise.all(
                [1, 2, 3, 4].map(() => createWallet({ tenantId: tenant.id, ownerId: user.id })),
            );

            for (const w of [wallet, ...extraWallets]) {
                await repository.upsert({
                    walletId: w.id,
                    tokenId: token.id,
                    balance: 1n,
                    blockNumber: 100n,
                });
            }

            const first = await repository.findPageForReconciliation(undefined, 2);
            const second = await repository.findPageForReconciliation(first[1].id, 2);
            const third = await repository.findPageForReconciliation(second[1].id, 2);

            const ids = [...first, ...second, ...third].map((row) => row.id);

            expect(first).toHaveLength(2);
            expect(second).toHaveLength(2);
            expect(third).toHaveLength(1);
            expect(new Set(ids).size).toBe(5);
            expect(ids).toEqual([...ids].sort());
        });
    });
});

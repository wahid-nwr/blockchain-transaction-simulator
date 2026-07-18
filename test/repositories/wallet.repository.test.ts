import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { WalletRepository } from '../../src/repositories/wallet.repository.js';
import { prisma } from '../../src/database/prisma.js';
import { cleanupDatabase } from '../helpers/cleanup.js';
import { createTenant } from '../factories/tenant.factory.js';
import { createUser } from '../factories/user.factory.js';
import { createWallet } from '../factories/wallet.factory.js';

describe('WalletRepository', () => {
    const repository = new WalletRepository();

    let tenant: any;
    let user: any;

    beforeEach(async () => {
        /*await cleanupDatabase();*/
        tenant = await createTenant();
        user = await createUser({
            tenant,
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('should create wallet', async () => {
        const wallet = await createWallet({
            tenantId: tenant.id,
            ownerId: user.id,
            chainId: 31337,
            address: '0xABC123',
        });

        expect(wallet.address).toBe('0xABC123');

        expect(wallet.chainId).toBe(31337);
    });

    it('should find wallets by owner', async () => {
        await createWallet({
            tenantId: tenant.id,
            ownerId: user.id,
            address: '0xwallet1',
        });

        await createWallet({
            tenantId: tenant.id,
            ownerId: user.id,
            address: '0xwallet2',
        });

        const result = await repository.findByOwnerId(user.id);

        expect(result).toHaveLength(2);
    });

    it('should find wallet by id', async () => {
        const wallet = await createWallet({
            tenantId: tenant.id,
            ownerId: user.id,
        });

        const result = await repository.findById(wallet.id);

        expect(result?.id).toBe(wallet.id);
    });

    it('should find wallet by address', async () => {
        await createWallet({
            tenantId: tenant.id,
            ownerId: user.id,
            address: '0xAbCd',
        });

        const wallet = await repository.findByAddress('0xabcd');

        expect(wallet).not.toBeNull();

        expect(wallet?.address).toBe('0xAbCd');
    });
});

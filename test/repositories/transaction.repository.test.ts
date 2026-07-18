import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import { prisma } from '../../src/database/prisma.js';
import { cleanupDatabase } from '../helpers/cleanup.js';
import { createTenant } from '../factories/tenant.factory.js';
import { createUser } from '../factories/user.factory.js';
import { createWallet } from '../factories/wallet.factory.js';
import { createToken } from '../factories/token.factory.js';
import { createTransaction } from '../factories/transaction.factory.js';

describe('TransactionRepository', () => {
    const repository = new TransactionRepository();

    let tenant: any;
    let user: any;
    let wallet1: any;
    let wallet2: any;
    let token: any;

    beforeEach(async () => {
        /*await cleanupDatabase();*/
        tenant = await createTenant();

        user = await createUser({
            tenant,
        });

        wallet1 = await createWallet({
            tenantId: tenant.id,
            ownerId: user.id,
        });
        wallet2 = await createWallet({
            tenantId: tenant.id,
            ownerId: user.id,
        });
        token = await createToken();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('should create pending transaction', async () => {
        const transaction = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        expect(transaction.status).toBe('PENDING');

        expect(transaction.amount).toBe(1000n);
    });

    it('should attach transaction hash', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        const updated = await repository.attachHash(tx.id, '0xhash');

        expect(updated.txHash).toBe('0xhash');
    });

    it('should confirm transaction', async () => {
        await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xhash',
        });

        const result = await repository.confirm('0xhash', {
            blockNumber: 100,
            gasUsed: 50000n,
        });

        expect(result.status).toBe('CONFIRMED');

        expect(result.blockNumber).toBe(100n);

        expect(result.gasUsed).toBe(50000n);
    });

    it('should find pending transactions', async () => {
        await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xhash',
        });

        const result = await repository.findPending();

        expect(result).toHaveLength(1);

        expect(result[0].txHash).toBe('0xhash');
    });
});

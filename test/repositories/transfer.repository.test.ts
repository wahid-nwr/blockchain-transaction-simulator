import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { TransferRepository } from '../../src/repositories/transfer.repository.js';
import { prisma } from '../../src/database/prisma.js';

import { cleanupDatabase } from '../helpers/cleanup.js';
import { createToken } from '../factories/token.factory.js';

describe('TransferRepository', () => {
    const repository = new TransferRepository();

    let token: any;

    beforeEach(async () => {
        /*await cleanupDatabase();*/
        token = await createToken();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('should create token transfer', async () => {
        const transfer = await repository.create({
            tokenId: token.id,
            from: '0xfrom',
            to: '0xto',
            amount: 1000n,
            transactionHash: '0xhash',
            blockNumber: 100n,
        });

        expect(transfer.transactionHash).toBe('0xhash');

        expect(transfer.amount).toBe(1000n);
    });

    it('should not duplicate transfer with same transaction hash', async () => {
        const first = await repository.create({
            tokenId: token.id,
            from: '0xfrom',
            to: '0xto',
            amount: 1000n,
            transactionHash: '0xhash',
            blockNumber: 100n,
        });

        const second = await repository.create({
            tokenId: token.id,
            from: '0xanother',
            to: '0xanother',
            amount: 5000n,
            transactionHash: '0xhash',
            blockNumber: 200n,
        });

        expect(second.id).toBe(first.id);

        expect(second.amount).toBe(1000n);
    });
});

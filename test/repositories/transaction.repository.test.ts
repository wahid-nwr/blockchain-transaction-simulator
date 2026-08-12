import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import { prisma } from '../../src/database/prisma.js';
import { createTenant } from '../factories/tenant.factory.js';
import { createUser } from '../factories/user.factory.js';
import { createWallet } from '../factories/wallet.factory.js';
import { createToken } from '../factories/token.factory.js';
import { createTransaction } from '../factories/transaction.factory.js';
import { TransactionStatus } from '@prisma/client';
import { TransactionStateConflictError } from '../../src/common/errors/transaction-state-conflict.error.js';

describe('TransactionRepository', () => {
    const repository = new TransactionRepository();

    let tenantContainer: any;
    let tenant: any;
    let user: any;
    let wallet1: any;
    let wallet2: any;
    let token: any;

    beforeEach(async () => {
        /*await cleanupDatabase();*/
        tenantContainer = await createTenant();
        tenant = tenantContainer.tenant;

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

        const updated = await repository.markSubmitted(tx.id, '0xhash');

        expect(updated.txHash).toBe('0xhash');
    });

    it('should confirm transaction', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xhash',
        });
        await repository.markSubmitted(tx.id, '0xhash');

        await repository.markConfirming(tx.id);

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

    it('should only return transaction belonging to tenant', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });
        const transaction = await repository.findById(tx.id, tenant.id);

        expect(transaction?.tenantId).toBe(tenant.id);
    });

    it('should transition pending transaction to submitted', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        const result = await repository.markSubmitted(tx.id, '0xsubmitted');

        expect(result.status).toBe(TransactionStatus.SUBMITTED);
        expect(result.txHash).toBe('0xsubmitted');
    });

    it('should transition submitted transaction to confirming', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        await repository.markSubmitted(tx.id, '0xconfirming');

        const result = await repository.markConfirming(tx.id);

        expect(result.status).toBe(TransactionStatus.CONFIRMING);
    });

    it('should transition pending transaction to failed', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        const result = await repository.markFailed(tx.id, 'submission failed');

        expect(result.status).toBe(TransactionStatus.FAILED);
        expect(result.failureReason).toBe('submission failed');
        expect(result.failedAt).not.toBeNull();
    });

    it('should transition confirming transaction to failed', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        await repository.markSubmitted(tx.id, '0xfailed');
        await repository.markConfirming(tx.id);

        const result = await repository.markFailed(tx.id, 'transaction reverted');

        expect(result.status).toBe(TransactionStatus.FAILED);
        expect(result.failureReason).toBe('transaction reverted');
        expect(result.failedAt).not.toBeNull();
    });

    it('should expire confirming transaction', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        await repository.markSubmitted(tx.id, '0xexpired');
        await repository.markConfirming(tx.id);

        const result = await repository.expire(tx.id, 'confirmation timeout');

        expect(result.status).toBe(TransactionStatus.EXPIRED);
        expect(result.failureReason).toBe('confirmation timeout');
        expect(result.failedAt).not.toBeNull();
    });

    it('should reject pending to confirming transition', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        await expect(repository.markConfirming(tx.id)).rejects.toThrow(
            TransactionStateConflictError,
        );
    });

    it('should reject confirming a transaction twice', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        await repository.markSubmitted(tx.id, '0xdouble');
        await repository.markConfirming(tx.id);

        await expect(repository.markConfirming(tx.id)).rejects.toThrow(
            TransactionStateConflictError,
        );
    });

    it('should reject confirming an already confirmed transaction', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        await repository.markSubmitted(tx.id, '0xconfirmed');
        await repository.markConfirming(tx.id);

        await repository.confirm('0xconfirmed', {
            blockNumber: 100,
            gasUsed: 50000n,
        });

        await expect(
            repository.confirm('0xconfirmed', {
                blockNumber: 101,
                gasUsed: 60000n,
            }),
        ).rejects.toThrow(TransactionStateConflictError);
    });

    it('should reject failing an already confirmed transaction', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        await repository.markSubmitted(tx.id, '0xterminal');
        await repository.markConfirming(tx.id);

        await repository.confirm('0xterminal', {
            blockNumber: 100,
            gasUsed: 50000n,
        });

        await expect(repository.markFailed(tx.id, 'late failure')).rejects.toThrow(
            TransactionStateConflictError,
        );
    });

    it('should reject failing an expired transaction', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        await repository.markSubmitted(tx.id, '0xexpire');
        await repository.markConfirming(tx.id);
        await repository.expire(tx.id, 'timeout');

        await expect(repository.markFailed(tx.id, 'late failure')).rejects.toThrow(
            TransactionStateConflictError,
        );
    });

    it('should allow only one concurrent confirmation', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xconfirmrace',
        });

        await repository.markSubmitted(tx.id, '0xconfirmrace');

        await repository.markConfirming(tx.id);

        const results = await Promise.allSettled([
            repository.confirm('0xconfirmrace', {
                blockNumber: 100,
                gasUsed: 50000n,
            }),
            repository.confirm('0xconfirmrace', {
                blockNumber: 100,
                gasUsed: 50000n,
            }),
        ]);

        const fulfilled = results.filter((result) => result.status === 'fulfilled');

        const rejected = results.filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        expect(rejected[0].status === 'rejected' ? rejected[0].reason : undefined).toBeInstanceOf(
            TransactionStateConflictError,
        );

        const final = await repository.findById(tx.id, tenant.id);

        expect(final?.status).toBe(TransactionStatus.CONFIRMED);
        expect(final?.blockNumber).toBe(100n);
        expect(final?.gasUsed).toBe(50000n);
    });

    it('should allow only one terminal transition when confirmation and failure race', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xterminalrace',
        });

        await repository.markSubmitted(tx.id, '0xterminalrace');

        await repository.markConfirming(tx.id);

        const results = await Promise.allSettled([
            repository.confirm('0xterminalrace', {
                blockNumber: 200,
                gasUsed: 75000n,
            }),
            repository.markFailed(tx.id, 'transaction reverted'),
        ]);

        const fulfilled = results.filter((result) => result.status === 'fulfilled');

        const rejected = results.filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        expect(rejected[0].status === 'rejected' ? rejected[0].reason : undefined).toBeInstanceOf(
            TransactionStateConflictError,
        );

        const final = await repository.findById(tx.id, tenant.id);

        expect([TransactionStatus.CONFIRMED, TransactionStatus.FAILED]).toContain(final?.status);
    });

    it('should atomically submit transaction with hash and submittedAt', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        expect(tx.status).toBe('PENDING');
        expect(tx.txHash).toBeNull();
        expect(tx.submittedAt).toBeNull();

        const before = new Date();

        const updated = await repository.markSubmitted(tx.id, '0xhash');

        const after = new Date();

        expect(updated.status).toBe('SUBMITTED');
        expect(updated.txHash).toBe('0xhash');
        expect(updated.submittedAt).not.toBeNull();

        expect(updated.submittedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());

        expect(updated.submittedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should allow only one concurrent submission', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
        });

        const results = await Promise.allSettled([
            repository.markSubmitted(tx.id, '0xhash1'),
            repository.markSubmitted(tx.id, '0xhash2'),
        ]);

        const fulfilled = results.filter((result) => result.status === 'fulfilled');

        const rejected = results.filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        const final = await prisma.transaction.findUniqueOrThrow({
            where: {
                id: tx.id,
            },
        });

        expect(final.status).toBe('SUBMITTED');
        expect(final.txHash).toMatch(/^0xhash[12]$/);
        expect(final.submittedAt).not.toBeNull();
    });

    it('should reject expiration from SUBMITTED', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xsubmitted-expire',
        });

        await repository.markSubmitted(tx.id, '0xsubmitted-expire');

        await expect(
            repository.expire(tx.id, 'Transaction confirmation timeout exceeded'),
        ).rejects.toThrow(TransactionStateConflictError);
    });

    it('should expire confirming transaction', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xexpire',
        });

        await repository.markSubmitted(tx.id, '0xexpire');
        await repository.markConfirming(tx.id);

        const result = await repository.expire(tx.id, 'Transaction confirmation timeout exceeded');

        expect(result.status).toBe('EXPIRED');
        expect(result.failureReason).toBe('Transaction confirmation timeout exceeded');
        expect(result.failedAt).toBeInstanceOf(Date);
    });

    it('should reject expiration of an already confirmed transaction', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xconfirmed-expire',
        });

        await repository.markSubmitted(tx.id, '0xconfirmed-expire');

        await repository.markConfirming(tx.id);

        await repository.confirm('0xconfirmed-expire', {
            blockNumber: 100,
            gasUsed: 50_000n,
        });

        await expect(
            repository.expire(tx.id, 'Transaction confirmation timeout exceeded'),
        ).rejects.toThrow(TransactionStateConflictError);
    });

    it('should reject expiration of an already failed transaction', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xfailed-expire',
        });

        await repository.markSubmitted(tx.id, '0xfailed-expire');

        await repository.markConfirming(tx.id);

        await repository.markFailed(tx.id, 'Transaction reverted');

        await expect(
            repository.expire(tx.id, 'Transaction confirmation timeout exceeded'),
        ).rejects.toThrow(TransactionStateConflictError);
    });

    it('should allow only one concurrent expiration', async () => {
        const tx = await createTransaction({
            tenantId: tenant.id,
            tokenId: token.id,
            fromWalletId: wallet1.id,
            toWalletId: wallet2.id,
            txHash: '0xconcurrent-expire',
        });

        await repository.markSubmitted(tx.id, '0xconcurrent-expire');

        await repository.markConfirming(tx.id);

        const [first, second] = await Promise.allSettled([
            repository.expire(tx.id, 'Transaction confirmation timeout exceeded'),
            repository.expire(tx.id, 'Transaction confirmation timeout exceeded'),
        ]);

        const fulfilled = [first, second].filter((result) => result.status === 'fulfilled');

        const rejected = [first, second].filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        expect(rejected[0].reason).toBeInstanceOf(TransactionStateConflictError);

        const final = await prisma.transaction.findUnique({
            where: {
                id: tx.id,
            },
        });

        expect(final?.status).toBe('EXPIRED');
    });
});

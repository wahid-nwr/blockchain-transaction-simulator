import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { TokenRepository } from '../../src/repositories/token.repository.js';
import { prisma } from '../../src/database/prisma.js';

import { createTenant } from '../factories/tenant.factory.js';
import { createToken } from '../factories/token.factory.js';

describe('TokenRepository', () => {
    const repository = new TokenRepository();

    let tenant: any;

    beforeEach(async () => {
        /*await cleanupDatabase();*/
        tenant = await createTenant();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('should create token', async () => {
        const token = await createToken({
            tenantId: tenant.id,
            name: 'Mini USDT',
            symbol: 'USDT',
            contractAddress: '0xtoken',
            decimals: 6,
        });

        expect(token.symbol).toBe('USDT');

        expect(token.decimals).toBe(6);
    });

    it('should find token by id', async () => {
        const token = await createToken({
            tenantId: tenant.id,
        });

        const result = await repository.findById(token.id);

        expect(result?.id).toBe(token.id);
    });

    it('should find token by contract address', async () => {
        await createToken({
            tenantId: tenant.id,
            contractAddress: '0xabc',
        });

        const result = await repository.findByContractAddress('0xabc');

        expect(result).not.toBeNull();

        expect(result?.contractAddress).toBe('0xabc');
    });

    it('should list tenant tokens', async () => {
        await createToken({
            tenantId: tenant.id,
        });

        await createToken({
            tenantId: tenant.id,
            symbol: 'USDC',
        });

        const result = await repository.findAll();

        expect(result).toHaveLength(2);
    });
});

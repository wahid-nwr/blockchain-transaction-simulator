import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { Prisma } from '@prisma/client';

describe('Prisma Error Handler', () => {
    it('maps P2002 unique constraint error to 409', async () => {
        const app = await buildApp();

        app.get('/test-p2002', async () => {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                code: 'P2002',
                clientVersion: '6.19.3',
                meta: {
                    target: ['email'],
                },
            });
        });

        const response = await app.inject({
            method: 'GET',
            url: '/test-p2002',
        });

        expect(response.statusCode).toBe(409);

        const body = response.json();

        expect(body.error.code).toBe('RESOURCE_ALREADY_EXISTS');

        expect(body.error.message).toBe('Resource already exists');

        expect(body.error.details).toEqual({
            target: ['email'],
        });

        await app.close();
    });

    it('maps P2025 record not found to 404', async () => {
        const app = await buildApp();

        app.get('/test-p2025', async () => {
            throw new Prisma.PrismaClientKnownRequestError('Record not found', {
                code: 'P2025',
                clientVersion: '6.19.3',
                meta: {
                    modelName: 'Wallet',
                },
            });
        });

        const response = await app.inject({
            method: 'GET',
            url: '/test-p2025',
        });

        expect(response.statusCode).toBe(404);

        const body = response.json();

        expect(body.error.code).toBe('RESOURCE_NOT_FOUND');

        await app.close();
    });

    it('maps P2003 foreign key error to 400', async () => {
        const app = await buildApp();

        app.get('/test-p2003', async () => {
            throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
                code: 'P2003',
                clientVersion: '6.19.3',
                meta: {
                    field_name: 'walletId',
                },
            });
        });

        const response = await app.inject({
            method: 'GET',
            url: '/test-p2003',
        });

        expect(response.statusCode).toBe(400);

        const body = response.json();

        expect(body.error.code).toBe('INVALID_REFERENCE');

        await app.close();
    });
});

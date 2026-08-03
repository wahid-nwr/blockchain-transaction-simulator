import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { AppError } from '../../src/common/errors/app.error.js';
import { z } from 'zod';

describe('Global Error Handler', () => {
    it('returns AppError response', async () => {
        const app = await buildApp();

        app.get('/test-app-error', async () => {
            throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found', {
                walletId: '123',
            });
        });

        const response = await app.inject({
            method: 'GET',
            url: '/test-app-error',
        });

        expect(response.statusCode).toBe(404);

        const body = response.json();

        expect(body.error.code).toBe('WALLET_NOT_FOUND');

        expect(body.error.message).toBe('Wallet not found');

        expect(body.error.details).toEqual({
            walletId: '123',
        });

        expect(body.requestId).toBeDefined();

        expect(body.timestamp).toBeDefined();

        await app.close();
    });

    it('returns 500 for unknown errors', async () => {
        const app = await buildApp();

        app.get('/test-error', async () => {
            throw new Error('database connection failed');
        });

        const response = await app.inject({
            method: 'GET',
            url: '/test-error',
        });

        expect(response.statusCode).toBe(500);

        const body = response.json();

        expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');

        expect(body.error.message).toBe('Unexpected error');

        await app.close();
    });

    it('returns validation error for invalid request', async () => {
        const app = await buildApp();

        app.post(
            '/test-validation',
            {
                schema: {
                    body: z.object({
                        name: z.string(),
                    }),
                },
            },
            async () => {
                return {
                    success: true,
                };
            },
        );

        const response = await app.inject({
            method: 'POST',
            url: '/test-validation',
            payload: {},
        });

        expect(response.statusCode).toBe(400);

        const body = response.json();

        expect(body.error.code).toBe('VALIDATION_ERROR');

        expect(body.error.details.length).toBeGreaterThan(0);

        await app.close();
    });

    it('does not expose internal error details', async () => {
        const app = await buildApp();

        app.get('/secret-error', async () => {
            throw new Error("SELECT * FROM users WHERE password='secret'");
        });

        const response = await app.inject({
            method: 'GET',
            url: '/secret-error',
        });

        const body = response.json();

        expect(body.error.message).toBe('Unexpected error');

        expect(JSON.stringify(body)).not.toContain('password');

        await app.close();
    });
});

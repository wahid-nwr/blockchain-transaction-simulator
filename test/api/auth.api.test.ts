import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/app.js';
import { createTenant } from '../factories/tenant.factory.js';
import { createTestUser } from '../helpers/users.js';

describe('Auth API', () => {
    it('registers a new user', async () => {
        const app = await createTestApp();
        const { apiKey } = await createTenant();
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            headers: {
                'x-tenant-key': apiKey,
            },
            payload: {
                email: 'api@test.com',
                password: 'password123',
            },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();

        expect(body.data.email).toBe('api@test.com');

        expect(body.data.role).toBe('USER');

        await app.close();
    });

    it('accepts valid login', async () => {
        const app = await createTestApp();
        const { email, password } = await createTestUser(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: {
                email,
                password,
            },
        });

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.data.accessToken).toBeDefined();

        expect(body.data.refreshToken).toBeDefined();

        await app.close();
    });

    it('rejects invalid login', async () => {
        const app = await createTestApp();

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: {
                email: 'missing@test.com',
                password: 'wrong1234',
            },
        });

        expect(response.statusCode).toBe(401);

        const body = response.json();

        expect(body.error.code).toBe('INVALID_CREDENTIALS');
        expect(body.error.message).toBe('Invalid email or password');

        await app.close();
    });

    it('allows the same user to log in concurrently without colliding on refresh token uniqueness', async () => {
        // Regression test for docs/incidents/002-refresh-token-collision.md:
        // concurrent logins used to sign byte-identical refresh-token JWTs
        // (same payload, same second-resolution `iat`), which collided on
        // RefreshToken.tokenHash's unique constraint and made every login
        // but the first in a given second fail with 409.
        const app = await createTestApp();
        const { email, password } = await createTestUser(app);

        const login = () =>
            app.inject({
                method: 'POST',
                url: '/api/v1/auth/login',
                payload: { email, password },
            });

        const responses = await Promise.all([login(), login(), login(), login(), login()]);

        for (const response of responses) {
            expect(response.statusCode).toBe(200);
        }

        const refreshTokens = responses.map((response) => response.json().data.refreshToken);
        expect(new Set(refreshTokens).size).toBe(refreshTokens.length);

        await app.close();
    });
});

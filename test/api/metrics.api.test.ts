import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { createAdminUser } from '../helpers/auth.js';

describe('Metrics API', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeAll(async () => {
        app = await buildApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it('should expose prometheus metrics endpoint', async () => {
        const { app, token } = await createAdminUser();
        const response = await app.inject({
            method: 'GET',
            headers: {
                authorization: `Bearer ${token}`,
            },
            url: '/api/v1/metrics',
        });

        expect(response.statusCode).toBe(200);

        expect(response.headers['content-type']).toContain('text/plain');

        expect(response.body).toContain('process_cpu_user_seconds_total');
    });

    it('should expose event listener metrics', async () => {
        const { app, token } = await createAdminUser();
        const response = await app.inject({
            method: 'GET',
            headers: {
                authorization: `Bearer ${token}`,
            },
            url: '/api/v1/metrics',
        });

        expect(response.statusCode).toBe(200);

        expect(response.body).toContain('event_listener_cycles_total');

        expect(response.body).toContain('event_listener_failures_total');
    });
});

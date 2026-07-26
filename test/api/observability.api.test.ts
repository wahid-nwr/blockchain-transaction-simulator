import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/api/app.js';

describe('Metrics API', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeAll(async () => {
        app = await buildApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it('should return request id', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/health',
        });
        expect(response.headers['x-request-id']).toBeDefined();
    });
});
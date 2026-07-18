import { createTenant } from '../factories/tenant.factory.js';

export async function createTestUser(app: FastifyInstance) {
    const tenant = await createTenant();

    const email = `user-${Date.now()}@test.com`;

    const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: {
            'x-tenant-key': tenant.apiKey,
        },
        payload: {
            email,
            password: 'password123',
        },
    });

    if (response.statusCode !== 201) {
        throw new Error(response.body);
    }

    return {
        tenant,
        email,
        password: 'password123',
    };
}

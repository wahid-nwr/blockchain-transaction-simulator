import { createTestApp } from './app.js';
import { createTenant } from '../factories/tenant.factory.js';
import { prisma } from '../../src/database/prisma.js';
import { attachCustodyKey } from './wallet-key.js';
import { fundAccount } from './anvil.js';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { Hex } from 'viem';

export async function createAuthenticatedUser(
    options: {
        disableWorkers?: boolean;
        walletPrivateKey?: Hex;
    } = {},
) {
    const app = await createTestApp(options);
    const { tenant, apiKey } = await createTenant();
    const email = `user-${Date.now()}@test.com`;
    const password = 'password123';

    const registerResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: {
            'x-tenant-key': apiKey,
        },
        payload: {
            email,
            password,
        },
    });

    if (registerResponse.statusCode !== 201) {
        throw new Error(registerResponse.body);
    }

    const user = await prisma.user.findUnique({
        where: {
            email,
        },
    });

    if (!user) {
        throw new Error('User was not created');
    }

    // CUSTODIAL by default so callers can submit real transfers without any
    // extra setup — the signing key lives server-side, encrypted via the
    // KMS_PROVIDER=local test envelope, never sent by the client.
    //
    // Each call gets its OWN freshly generated key (unless explicitly
    // overridden) rather than reusing a fixed ANVIL_ACCOUNTS entry — the
    // derived address is unique per Wallet row (there's a DB unique
    // constraint on address), so reusing one key across multiple calls
    // collides the moment more than one authenticated user exists in a run,
    // which this suite does constantly. A freshly generated key has no ETH
    // on Anvil by default, so it's funded via the setBalance cheat code
    // rather than relying on it being one of Anvil's pre-funded accounts.
    const signingPrivateKey: Hex = options.walletPrivateKey ?? generatePrivateKey();
    const address = privateKeyToAccount(signingPrivateKey).address;
    await fundAccount(address);

    const wallet = await prisma.wallet.create({
        data: {
            tenantId: tenant.id,
            ownerId: user.id,
            chainId: 31337,
            address,
            custodyType: 'CUSTODIAL',
        },
    });
    await attachCustodyKey(wallet.id, signingPrivateKey);

    const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
            email,
            password,
        },
    });

    if (loginResponse.statusCode !== 200) {
        throw new Error(loginResponse.body);
    }

    const body = loginResponse.json();

    return {
        app,
        tenant,
        user,
        wallet,
        token: body.data.accessToken,
        email,
        password,
    };
}

export async function createAdminUser() {
    const app = await createTestApp();

    const { tenant, apiKey } = await createTenant();

    const email = `admin-${Date.now()}@test.com`;

    const password = 'password123';

    await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: {
            'x-tenant-key': apiKey,
        },
        payload: {
            email,
            password,
        },
    });

    const user = await prisma.user.findUnique({
        where: {
            email,
        },
    });

    await prisma.user.update({
        where: {
            id: user!.id,
        },
        data: {
            role: 'ADMIN',
        },
    });

    const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
            email,
            password,
        },
    });

    return {
        app,
        tenant,
        token: login.json().data.accessToken,
    };
}

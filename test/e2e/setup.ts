import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

const E2E_DATABASE_URL =
    process.env.E2E_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:65433/blockchain_simulator_e2e';

process.env.DATABASE_URL = E2E_DATABASE_URL;

const { prisma } = await import('../../src/database/prisma.js');

import { attachCustodyKey } from '../helpers/wallet-key.js';
import { ANVIL_ACCOUNTS, fundAccount } from '../helpers/anvil.js';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3002';
const FIXTURE_DIR = process.env.E2E_FIXTURE_DIR ?? '/tmp/blockchain-e2e';
const FIXTURE_FILE = process.env.E2E_FIXTURE_FILE ?? `${FIXTURE_DIR}/fixtures.json`;

const PASSWORD = 'password123';

type Fixture = {
    tenant: {
        id: string;
        apiKey: string;
    };
    admin: {
        id: string;
        email: string;
        password: string;
    };
    sender: {
        id: string;
        email: string;
        password: string;
        walletId: string;
        address: string;
    };
    receiver: {
        id: string;
        email: string;
        password: string;
        walletId: string;
        address: string;
    };
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            'content-type': 'application/json',
            ...(options.headers ?? {}),
        },
    });

    const text = await response.text();

    let body: unknown;

    try {
        body = JSON.parse(text);
    } catch {
        throw new Error(`E2E setup received invalid JSON from ${path}: ${text}`);
    }

    if (!response.ok) {
        throw new Error(
            `E2E setup request failed: ${options.method ?? 'GET'} ${path} ` +
                `${response.status}: ${JSON.stringify(body)}`,
        );
    }

    return body as T;
}

type ApiResponse<T> = {
    data: T;
    requestId: string;
};

type TenantResponse = {
    tenant: {
        id: string;
        name: string;
        apiKeys: Array<{
            id: string;
            tenantId: string;
            keyHash: string;
            keyPrefix: string;
            name: string;
            active: boolean;
            scopes: string[];
            lastUsedAt: string | null;
            expiresAt: string | null;
            createdAt: string;
            revokedAt: string | null;
        }>;
    };
    apiKey: string;
};

type UserResponse = {
    id: string;
    email: string;
    role: string;
    tenantId: string;
    createdAt: string;
};

async function registerUser(apiKey: string, email: string): Promise<UserResponse> {
    const response = await request<ApiResponse<UserResponse>>('/api/v1/auth/register', {
        method: 'POST',
        headers: {
            'x-tenant-key': apiKey,
        },
        body: JSON.stringify({
            email,
            password: PASSWORD,
        }),
    });

    return response.data;
}

async function createCustodialWallet(ownerId: string, tenantId: string, privateKey: Hex) {
    const account = privateKeyToAccount(privateKey);

    await fundAccount(account.address);

    const wallet = await prisma.wallet.create({
        data: {
            tenantId,
            ownerId,
            chainId: 31337,
            address: account.address,
            custodyType: 'CUSTODIAL',
        },
    });

    await attachCustodyKey(wallet.id, privateKey);

    return wallet;
}

async function main() {
    await mkdir(FIXTURE_DIR, { recursive: true });

    /*
     * Tenant
     */
    const tenantResponse = await request<ApiResponse<TenantResponse>>('/api/v1/tenants', {
        method: 'POST',
        body: JSON.stringify({
            name: `E2E Tenant ${randomUUID()}`,
        }),
    });

    const { tenant, apiKey } = tenantResponse.data;

    /*
     * Users
     */
    const adminEmail = `e2e-admin-${randomUUID()}@test.com`;
    const senderEmail = `e2e-sender-${randomUUID()}@test.com`;
    const receiverEmail = `e2e-receiver-${randomUUID()}@test.com`;

    const admin = await registerUser(apiKey, adminEmail);
    const sender = await registerUser(apiKey, senderEmail);
    const receiver = await registerUser(apiKey, receiverEmail);

    /*
     * Promote admin directly in the test database.
     *
     * Role management is deliberately not exposed as a production API
     * operation merely for E2E setup.
     */
    await prisma.user.update({
        where: {
            id: admin.id,
        },
        data: {
            role: 'ADMIN',
        },
    });

    /*
     * Use deterministic Anvil accounts so that the E2E fixture has
     * funded signing accounts available immediately.
     */
    const senderPrivateKey = ANVIL_ACCOUNTS.user;
    const receiverPrivateKey = ANVIL_ACCOUNTS.receiver;

    const senderAccount = privateKeyToAccount(senderPrivateKey);
    const receiverAccount = privateKeyToAccount(receiverPrivateKey);

    const senderWallet = await createCustodialWallet(sender.id, tenant.id, senderPrivateKey);
    const receiverWallet = await createCustodialWallet(receiver.id, tenant.id, receiverPrivateKey);

    /*
     * Persist only public fixture information.
     *
     * Private keys are intentionally NOT written to the fixture file.
     */
    const fixture: Fixture = {
        tenant: {
            id: tenant.id,
            apiKey: apiKey,
        },
        admin: {
            id: admin.id,
            email: admin.email,
            password: PASSWORD,
        },
        sender: {
            id: sender.id,
            email: sender.email,
            password: PASSWORD,
            walletId: senderWallet.id,
            address: senderAccount.address,
        },
        receiver: {
            id: receiver.id,
            email: receiver.email,
            password: PASSWORD,
            walletId: receiverWallet.id,
            address: receiverAccount.address,
        },
    };

    await writeFile(FIXTURE_FILE, JSON.stringify(fixture, null, 2), 'utf8');

    console.log(`E2E fixtures written to ${FIXTURE_FILE}`);
    console.log(`Tenant: ${tenant.id}`);
    console.log(`Admin: ${admin.email}`);
    console.log(`Sender wallet: ${senderWallet.address}`);
    console.log(`Receiver wallet: ${receiverWallet.address}`);
}

main()
    .catch((error) => {
        console.error('E2E setup failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

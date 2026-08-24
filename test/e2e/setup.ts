import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import { createPublicClient, createWalletClient, http, Hex } from 'viem';

import { localhost } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

import { encryptWalletKey } from '../../src/crypto/envelope.js';
import artifact from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };
const { ANVIL_ACCOUNTS } = await import('../helpers/anvil.js');

const E2E_DATABASE_URL =
    process.env.E2E_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:65433/blockchain_simulator_e2e';
process.env.DATABASE_URL = E2E_DATABASE_URL;

const LOCAL_KMS_MASTER_KEY =
    process.env.LOCAL_KMS_MASTER_KEY ??
    '0101010101010101010101010101010101010101010101010101010101010101';
process.env.LOCAL_KMS_MASTER_KEY = LOCAL_KMS_MASTER_KEY;

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3002';
const RPC_URL = process.env.E2E_RPC_URL ?? 'http://localhost:8546';

const FIXTURE_FILE = process.env.E2E_FIXTURE_FILE ?? '/tmp/blockchain-e2e/fixtures.json';

const MINTER_PRIVATE_KEY =
    process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasourceUrl: process.env.E2E_DATABASE_URL,
});

type UserResponse = {
    id: string;
    email: string;
    role: string;
    tenantId: string;
    createdAt: string;
};

type AuthResponse = {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
};

type ApiResponse<T> = {
    data: T;
    requestId: string;
};

type Fixture = {
    contractAddress: string;

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

const client = createPublicClient({
    chain: localhost,
    transport: http(RPC_URL),
});

async function request<T>(
    path: string,
    options: RequestInit = {},
): Promise<{
    status: number;
    body: T;
}> {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            'content-type': 'application/json',
            ...(options.headers ?? {}),
        },
    });

    const text = await response.text();

    let body: T;

    try {
        body = JSON.parse(text) as T;
    } catch {
        throw new Error(`Invalid JSON response from ${path}: ${response.status} ${text}`);
    }

    return {
        status: response.status,
        body,
    };
}

async function waitForApi(timeoutMs = 60_000, intervalMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    console.log(`Waiting for E2E API at ${API_URL}...`);

    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${API_URL}/api/v1/health`);

            if (response.ok) {
                console.log('E2E API is ready.');
                return;
            }
        } catch {
            // API is not ready yet.
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`E2E API did not become ready within ${timeoutMs}ms: ${API_URL}`);
}

async function waitForRpc(timeoutMs = 60_000, intervalMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    console.log(`Waiting for Anvil at ${RPC_URL}...`);

    while (Date.now() < deadline) {
        try {
            const blockNumber = await client.getBlockNumber();

            console.log(`Anvil is ready. Current block: ${blockNumber}`);
            return;
        } catch {
            // Anvil is not ready yet.
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Anvil did not become ready within ${timeoutMs}ms: ${RPC_URL}`);
}

async function resetAnvil(): Promise<void> {
    console.log(`Resetting Anvil at ${RPC_URL}...`);

    const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'anvil_reset',
            params: [],
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to reset Anvil: ${response.status} ${await response.text()}`);
    }

    const result = (await response.json()) as {
        error?: {
            code: number;
            message: string;
        };
    };

    if (result.error) {
        throw new Error(`Anvil reset failed: ${result.error.code} ${result.error.message}`);
    }

    console.log('Anvil reset completed.');
}

async function deployMiniUSDT(): Promise<string> {
    console.log(`Deploying MiniUSDT to ${RPC_URL}...`);

    const account = privateKeyToAccount(MINTER_PRIVATE_KEY as `0x${string}`);

    const walletClient = createWalletClient({
        account,
        chain: localhost,
        transport: http(RPC_URL),
    });

    console.log('Deploying with:', account.address);

    const MiniUSDTAbi = artifact.abi;
    const MiniUSDTBytecode = artifact.bytecode as `0x${string}`;

    // Use the compiled MiniUSDT artifact here.
    const hash = await walletClient.deployContract({
        abi: MiniUSDTAbi,
        bytecode: MiniUSDTBytecode,
        args: [],
    });

    console.log('Deployment tx hash:', hash);

    const receipt = await client.waitForTransactionReceipt({
        hash,
    });

    if (receipt.status !== 'success') {
        throw new Error(`MiniUSDT deployment failed: ${hash}`);
    }

    const address = receipt.contractAddress;

    if (!address) {
        throw new Error(
            `MiniUSDT deployment succeeded but no contract address was returned: ${hash}`,
        );
    }

    const code = await client.getBytecode({
        address,
    });

    if (!code || code === '0x') {
        throw new Error(
            `MiniUSDT deployment reported success but no bytecode exists at ${address}`,
        );
    }

    console.log('MiniUSDT deployed at:', address);
    console.log('Deployment block:', receipt.blockNumber);
    console.log('Bytecode length:', code.length);

    return address;
}

async function cleanupDatabase(): Promise<void> {
    console.log('Cleaning E2E database...');

    await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE
            "BalanceSnapshot",
            "TokenTransfer",
            "Transaction",
            "TokenEventCursor",
            "Token",
            "Wallet",
            "RefreshToken",
            "ApiKey",
            "User",
            "Tenant"
        RESTART IDENTITY CASCADE;
    `);

    console.log('E2E database cleaned.');
}

async function login(email: string, password: string): Promise<string> {
    const response = await request<ApiResponse<AuthResponse>>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email,
            password,
        }),
    });

    if (response.status !== 200) {
        throw new Error(`Login failed: HTTP ${response.status}: ${JSON.stringify(response.body)}`);
    }

    if (!response.body?.data?.accessToken) {
        throw new Error(`Login response missing accessToken: ${JSON.stringify(response.body)}`);
    }

    return response.body.data.accessToken;
}

async function attachCustodyKey(walletId: string, privateKey: Hex, kmsKeyId = 'test-key') {
    // Buffer's `buffer` property is typed as ArrayBufferLike (which includes
    // SharedArrayBuffer), but Prisma's Bytes fields want Uint8Array<ArrayBuffer>
    // specifically. Uint8Array.from() copies into a fresh, plain-ArrayBuffer-backed
    // Uint8Array, which satisfies that narrower type.
    const encryptedKey = Uint8Array.from(await encryptWalletKey(privateKey, kmsKeyId));

    return prisma.walletCustodyKey.create({
        data: {
            walletId,
            encryptedKey,
            kmsKeyId,
        },
    });
}

async function createFixture(contractAddress: string): Promise<Fixture> {
    /*
     * These values should match the API routes currently used by the
     * project. The important point is that all fixture data is created
     * AFTER the database has been cleaned and AFTER the contract has
     * been freshly deployed.
     */

    const tenantResponse = await request<
        ApiResponse<{
            id: string;
            apiKey: string;
            tenant: {
                id: string;
                name: string;
                createdAt: string;
            };
        }>
    >('/api/v1/tenants', {
        method: 'POST',
        body: JSON.stringify({
            name: 'E2E Tenant',
        }),
    });

    if (tenantResponse.status !== 201) {
        throw new Error(
            `Failed to create tenant: ${tenantResponse.status} ${JSON.stringify(
                tenantResponse.body,
            )}`,
        );
    }

    const tenant = tenantResponse.body.data.tenant;
    const apiKey = tenantResponse.body.data.apiKey;
    const adminPassword = 'Admin123!';

    const adminResponse = await request<
        ApiResponse<{
            id: string;
            email: string;
        }>
    >('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'x-tenant-key': apiKey },
        body: JSON.stringify({
            email: 'admin-e2e@example.com',
            password: adminPassword,
        }),
    });

    if (adminResponse.status !== 201) {
        throw new Error(
            `Failed to create admin: ${adminResponse.status} ${JSON.stringify(adminResponse.body)}`,
        );
    }

    const admin = {
        ...adminResponse.body.data,
        password: adminPassword,
    };

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

    const senderPassword = 'Sender123!';
    const senderEmail = 'sender-e2e@example.com';

    const senderResponse = await request<ApiResponse<UserResponse>>('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'x-tenant-key': apiKey },
        body: JSON.stringify({
            email: senderEmail,
            password: senderPassword,
            tenantId: tenant.id,
        }),
    });

    if (senderResponse.status !== 201) {
        throw new Error(
            `Failed to create sender: ${senderResponse.status} ${JSON.stringify(
                senderResponse.body,
            )}`,
        );
    }

    const receiverPassword = 'Receiver123!';
    const receiverEmail = 'receiver-e2e@example.com';

    const receiverResponse = await request<ApiResponse<UserResponse>>('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'x-tenant-key': apiKey },
        body: JSON.stringify({
            email: receiverEmail,
            password: receiverPassword,
            tenantId: tenant.id,
        }),
    });

    if (receiverResponse.status !== 201) {
        throw new Error(
            `Failed to create receiver: ${receiverResponse.status} ${JSON.stringify(
                receiverResponse.body,
            )}`,
        );
    }

    /*
     * Login admin so we can create wallets through the real API.
     */

    const senderToken = await login(senderEmail, senderPassword);
    const receiverToken = await login(receiverEmail, receiverPassword);

    const senderPrivateKey = ANVIL_ACCOUNTS.user;
    const senderAccount = privateKeyToAccount(senderPrivateKey);

    const senderWalletResponse = await request<
        ApiResponse<{
            id: string;
            address: string;
        }>
    >('/api/v1/wallets', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${senderToken}`,
        },
        body: JSON.stringify({
            ownerId: senderResponse.body.data.id,
            chainId: 31337,
            address: senderAccount.address,
        }),
    });

    if (senderWalletResponse.status !== 201) {
        throw new Error(
            `Failed to create sender wallet: ${
                senderWalletResponse.status
            } ${JSON.stringify(senderWalletResponse.body)}`,
        );
    }

    const receiverPrivateKey = ANVIL_ACCOUNTS.receiver;
    const receiverAccount = privateKeyToAccount(receiverPrivateKey);

    const receiverWalletResponse = await request<
        ApiResponse<{
            id: string;
            address: string;
        }>
    >('/api/v1/wallets', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${receiverToken}`,
        },
        body: JSON.stringify({
            chainId: 31337,
            address: receiverAccount.address,
        }),
    });

    if (receiverWalletResponse.status !== 201) {
        throw new Error(
            `Failed to create receiver wallet: ${
                receiverWalletResponse.status
            } ${JSON.stringify(receiverWalletResponse.body)}`,
        );
    }
    await prisma.wallet.update({
        where: {
            id: senderWalletResponse.body.data.id,
        },
        data: {
            custodyType: 'CUSTODIAL',
        },
    });
    await attachCustodyKey(senderWalletResponse.body.data.id, senderPrivateKey, 'test-key');
    const swallet = await prisma.wallet.findUnique({
        where: {
            id: senderWalletResponse.body.data.id,
        },
    });
    await prisma.wallet.update({
        where: {
            id: receiverWalletResponse.body.data.id,
        },
        data: {
            custodyType: 'CUSTODIAL',
        },
    });
    await attachCustodyKey(receiverWalletResponse.body.data.id, receiverPrivateKey, 'test-key');

    return {
        contractAddress,

        tenant: {
            id: tenant.id,
            apiKey: apiKey,
        },

        admin,

        sender: {
            id: senderResponse.body.data.id,
            email: senderEmail,
            password: senderPassword,
            walletId: senderWalletResponse.body.data.id,
            address: senderWalletResponse.body.data.address,
        },

        receiver: {
            id: receiverResponse.body.data.id,
            email: receiverEmail,
            password: receiverPassword,
            walletId: receiverWalletResponse.body.data.id,
            address: receiverWalletResponse.body.data.address,
        },
    };
}

async function main(): Promise<void> {
    console.log(`E2E DATABASE_URL: ${process.env.DATABASE_URL}`);
    console.log(`E2E API_URL: ${API_URL}`);
    console.log(`E2E RPC_URL: ${RPC_URL}`);

    /*
     * The API/worker containers are started by docker compose before
     * setup.ts runs. We therefore wait for their dependencies explicitly.
     */
    await waitForRpc();
    await waitForApi();

    await cleanupDatabase();

    console.log('Deploy RPC:', RPC_URL);

    const before = await client.getBlockNumber();
    console.log('Block before reset:', before);

    await resetAnvil();

    const afterReset = await client.getBlockNumber();
    console.log('Block after reset:', afterReset);

    const contractAddress = await deployMiniUSDT();

    console.log('Returned contract address:', contractAddress);

    const code = await client.getBytecode({
        address: contractAddress as `0x${string}`,
    });

    console.log('Deployed bytecode length:', code?.length ?? 0);
    console.log('Deployed bytecode prefix:', code?.slice(0, 20));

    /*
     * The database has already been cleaned, and the API is ready.
     * Create fresh E2E users/wallets.
     */
    const fixture = await createFixture(contractAddress);

    await mkdir('/tmp/blockchain-e2e', {
        recursive: true,
    });

    await writeFile(FIXTURE_FILE, JSON.stringify(fixture, null, 2), 'utf8');

    console.log(`E2E fixture written to ${FIXTURE_FILE}`);
    console.log('E2E setup completed successfully.');
}

main()
    .catch((error) => {
        console.error('E2E setup failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

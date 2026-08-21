import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { http } from './helpers/http.js';

const FIXTURE_FILE = process.env.E2E_FIXTURE_FILE ?? '/tmp/blockchain-e2e/fixtures.json';

type ApiResponse<T> = {
    data: T;
    requestId: string;
};

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

type AuthResponse = {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
};

type Token = {
    id: string;
    tokenId: string;
    name: string;
    symbol: string;
    contractAddress: string;
    decimals: number;
};

type Transaction = {
    id: string;
    status: string;
    txHash: string | null;
    blockNumber: string | number | null;
    gasUsed: string | number | null;
    confirmationStartedAt: string | null;
    confirmedAt: string | null;
};

type Balance = {
    walletId: string;
    tokenId: string;
    balance: string;
};

async function loadFixture(): Promise<Fixture> {
    const contents = await readFile(FIXTURE_FILE, 'utf8');
    return JSON.parse(contents) as Fixture;
}

function authHeaders(accessToken: string) {
    return {
        authorization: `Bearer ${accessToken}`,
    };
}

async function login(email: string, password: string): Promise<string> {
    const response = await http<ApiResponse<AuthResponse>>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email,
            password,
        }),
    });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeTruthy();

    return response.body.data.accessToken;
}

async function waitFor<T>(
    operation: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 30_000,
    intervalMs = 500,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;

    let lastValue: T | undefined;

    while (Date.now() < deadline) {
        lastValue = await operation();
        if (predicate(lastValue)) {
            return lastValue;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
        `E2E condition was not satisfied within ${timeoutMs}ms. ` +
            `Last value: ${JSON.stringify(lastValue)}`,
    );
}

describe('Transaction Lifecycle E2E', () => {
    it('should complete the transaction lifecycle through the real HTTP API', async () => {
        const fixture = await loadFixture();

        /*
         * ---------------------------------------------------------------
         * 1. Login as admin
         * ---------------------------------------------------------------
         */

        const adminToken = await login(fixture.admin.email, fixture.admin.password);

        /*
         * ---------------------------------------------------------------
         * 2. Verify authenticated identity
         * ---------------------------------------------------------------
         */

        const meResponse = await http<
            ApiResponse<{
                userId: string;
                email: string;
                role: string;
                tenantId: string;
            }>
        >('/api/v1/wallets/me', {
            headers: authHeaders(adminToken),
        });

        expect(meResponse.status).toBe(200);
        expect(meResponse.body.data.userId).toBe(fixture.admin.id);
        expect(meResponse.body.data.role).toBe('ADMIN');
        expect(meResponse.body.data.tenantId).toBe(fixture.tenant.id);

        /*
         * ---------------------------------------------------------------
         * 3. Register deployed MiniUSDT
         * ---------------------------------------------------------------
         *
         * The deployment script currently produces this deterministic
         * Anvil address:
         *
         * 0x5FbDB2315678afecb367f032d93F642f64180aa3
         *
         * This is the standard Hardhat/Anvil first deployment address.
         */

        const contractAddress =
            process.env.E2E_CONTRACT_ADDRESS ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3';

        const tokenResponse = await http<ApiResponse<Token>>('/api/v1/tokens', {
            method: 'POST',
            headers: authHeaders(adminToken),
            body: JSON.stringify({
                tokenId: randomUUID(),
                name: 'MiniUSDT',
                symbol: 'USDT',
                contractAddress,
                decimals: 6,
            }),
        });

        expect(tokenResponse.status).toBe(201);

        const token = tokenResponse.body.data;

        expect(token.contractAddress.toLowerCase()).toBe(contractAddress.toLowerCase());
        expect(token.symbol).toBe('USDT');

        /*
         * ---------------------------------------------------------------
         * 4. Mint through the real API
         * ---------------------------------------------------------------
         */

        console.log(fixture.sender.address);
        const mintResponse = await http<
            ApiResponse<{
                transactionHash: string;
            }>
        >(`/api/v1/tokens/${token.id}/mint`, {
            method: 'POST',
            headers: authHeaders(adminToken),
            body: JSON.stringify({
                receiver: fixture.sender.address,
                amount: '1000000000',
            }),
        });

        expect(mintResponse.status).toBe(200);

        expect(mintResponse.body.data.transactionHash).toMatch(/^0x[0-9a-fA-F]+$/);

        /*
         * ---------------------------------------------------------------
         * 5. Wait for the real event listener to index the mint
         * ---------------------------------------------------------------
         */

        const senderBalanceAfterMint = await waitFor(
            async () => {
                return http<ApiResponse<Balance | null>>(
                    `/api/v1/tokens/${token.id}/balance/${fixture.sender.walletId}`,
                    {
                        headers: authHeaders(adminToken),
                    },
                );
            },
            (response) =>
                response.status === 200 &&
                response.body.data !== null &&
                BigInt(response.body.data.balance) === 1000000000n,
            30_000,
        );

        expect(senderBalanceAfterMint.body.data).not.toBeNull();
        expect(BigInt(senderBalanceAfterMint.body.data!.balance)).toBe(1000000000n);

        /*
         * ---------------------------------------------------------------
         * 6. Login as sender
         * ---------------------------------------------------------------
         */

        const senderToken = await login(fixture.sender.email, fixture.sender.password);
        const receiverToken = await login(fixture.receiver.email, fixture.receiver.password);

        /*
         * ---------------------------------------------------------------
         * 7. Submit transfer through the real HTTP API
         * ---------------------------------------------------------------
         */

        const transferResponse = await http<ApiResponse<Transaction>>('/api/v1/transactions', {
            method: 'POST',
            headers: authHeaders(senderToken),
            body: JSON.stringify({
                tokenId: token.id,
                fromWalletId: fixture.sender.walletId,
                toWalletId: fixture.receiver.walletId,
                amount: '100',
            }),
        });

        expect(transferResponse.status).toBe(201);

        const submitted = transferResponse.body.data;

        expect(submitted.id).toBeTruthy();
        expect(submitted.txHash).toMatch(/^0x[0-9a-fA-F]+$/);
        expect(['SUBMITTED', 'CONFIRMING', 'CONFIRMED']).toContain(submitted.status);

        /*
         * ---------------------------------------------------------------
         * 8. Wait for the REAL BullMQ confirmation worker
         * ---------------------------------------------------------------
         */

        const confirmed = await waitFor(
            async () => {
                return http<ApiResponse<Transaction>>(`/api/v1/transactions/${submitted.id}`, {
                    headers: authHeaders(senderToken),
                });
            },
            (response) => response.status === 200 && response.body.data.status === 'CONFIRMED',
            30_000,
        );

        const transaction = confirmed.body.data;

        expect(transaction.status).toBe('CONFIRMED');
        expect(transaction.txHash).toBe(submitted.txHash);
        expect(transaction.confirmationStartedAt).not.toBeNull();
        expect(transaction.confirmedAt).not.toBeNull();
        expect(transaction.blockNumber).not.toBeNull();
        expect(transaction.gasUsed).not.toBeNull();

        /*
         * ---------------------------------------------------------------
         * 9. Verify sender balance
         * ---------------------------------------------------------------
         */

        const senderBalance = await waitFor(
            async () => {
                return http<ApiResponse<Balance | null>>(
                    `/api/v1/tokens/${token.id}/balance/${fixture.sender.walletId}`,
                    {
                        headers: authHeaders(senderToken),
                    },
                );
            },
            (response) =>
                response.status === 200 &&
                response.body.data !== null &&
                BigInt(response.body.data.balance) === 900000000n,
        );

        expect(senderBalance.body.data).not.toBeNull();
        expect(BigInt(senderBalance.body.data!.balance)).toBe(900000000n);

        /*
         * ---------------------------------------------------------------
         * 10. Verify receiver balance
         * ---------------------------------------------------------------
         */

        const receiverBalance = await waitFor(
            async () => {
                return http<ApiResponse<Balance | null>>(
                    `/api/v1/tokens/${token.id}/balance/${fixture.receiver.walletId}`,
                    {
                        headers: authHeaders(receiverToken),
                    },
                );
            },
            (response) =>
                response.status === 200 &&
                response.body.data !== null &&
                BigInt(response.body.data.balance) === 100000000n,
        );

        expect(receiverBalance.body.data).not.toBeNull();
        expect(BigInt(receiverBalance.body.data!.balance)).toBe(100000000n);

        /*
         * ---------------------------------------------------------------
         * 11. Verify transaction through GET endpoint
         * ---------------------------------------------------------------
         */

        const transactionResponse = await http<ApiResponse<Transaction>>(
            `/api/v1/transactions/${submitted.id}`,
            {
                headers: authHeaders(senderToken),
            },
        );

        expect(transactionResponse.status).toBe(200);
        expect(transactionResponse.body.data.id).toBe(submitted.id);
        expect(transactionResponse.body.data.status).toBe('CONFIRMED');
    }, 30_000);
});

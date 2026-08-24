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

type Balance = {
    walletId: string;
    tokenId: string;
    balance: string;
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
         * -----------------------------------------------------------
         * 1. Login admin
         * -----------------------------------------------------------
         */

        const adminToken = await login(fixture.admin.email, fixture.admin.password);

        /*
         * -----------------------------------------------------------
         * 5. Login sender
         * -----------------------------------------------------------
         */

        const senderToken = await login(fixture.sender.email, fixture.sender.password);

        /*
         * -----------------------------------------------------------
         * 2. Verify authenticated identity
         * -----------------------------------------------------------
         */

        const meResponse = await http<
            ApiResponse<{
                userId: string;
                email: string;
                role: string;
                tenantId: string;
            }>
        >('/api/v1/wallets/me', {
            headers: authHeaders(senderToken),
        });

        expect(meResponse.status).toBe(200);

        expect(meResponse.body.data.userId).toBe(fixture.sender.id);

        expect(meResponse.body.data.role).toBe('USER');

        expect(meResponse.body.data.tenantId).toBe(fixture.tenant.id);

        /*
         * -----------------------------------------------------------
         * 3. Register the freshly deployed MiniUSDT
         * -----------------------------------------------------------
         */

        const tokenResponse = await http<ApiResponse<Token>>('/api/v1/tokens', {
            method: 'POST',
            headers: authHeaders(adminToken),
            body: JSON.stringify({
                tokenId: randomUUID(),
                name: 'MiniUSDT',
                symbol: 'USDT',
                contractAddress: fixture.contractAddress,
                decimals: 6,
            }),
        });

        expect(tokenResponse.status).toBe(201);

        const token = tokenResponse.body.data;

        expect(token.contractAddress.toLowerCase()).toBe(fixture.contractAddress.toLowerCase());

        /*
         * -----------------------------------------------------------
         * 4. Mint through the real API
         * -----------------------------------------------------------
         */

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

        const mintTxHash = mintResponse.body.data.transactionHash;

        expect(mintTxHash).toMatch(/^0x[0-9a-fA-F]+$/);

        console.log('Mint transaction:', mintTxHash);

        /*
         * -----------------------------------------------------------
         * 6. Wait for event listener + balance sync
         * -----------------------------------------------------------
         *
         * The important assertion here is against the database
         * balance, not directly against the chain.
         *
         * The event listener must:
         *
         * Transfer event
         *       ↓
         * TokenTransfer
         *       ↓
         * BalanceSyncService
         *       ↓
         * BalanceSnapshot
         */

        /*const senderBalanceAfterMint = await waitFor(
            async () => {
                const response = await http<ApiResponse<Balance | null>>(
                    `/api/v1/tokens/${token.id}/balance/${fixture.sender.walletId}`,
                    {
                        headers: authHeaders(adminToken),
                    },
                );

                return response;
            },
            (response) =>
                response.status === 200 &&
                response.body.data !== null &&
                BigInt(response.body.data.balance) === 1000000000n,
            30_000,
            500,
        );

        expect(senderBalanceAfterMint.body.data).not.toBeNull();

        expect(BigInt(senderBalanceAfterMint.body.data!.balance)).toBe(1000000000n);*/

        /*
         * -----------------------------------------------------------
         * 7. Login receiver
         * -----------------------------------------------------------
         */

        const receiverToken = await login(fixture.receiver.email, fixture.receiver.password);

        /*
         * -----------------------------------------------------------
         * 8. Submit transfer
         * -----------------------------------------------------------
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
        console.log('TRANSFER RESPONSE:', {
            status: transferResponse.status,
            body: transferResponse.body,
        });

        expect(transferResponse.status).toBe(201);

        const createdTransaction = transferResponse.body.data;

        expect(createdTransaction.id).toBeTruthy();

        /*
         * -----------------------------------------------------------
         * 9. Wait for transaction confirmation
         * -----------------------------------------------------------
         */

        const confirmedTransaction = await waitFor(
            async () => {
                const response = await http<ApiResponse<Transaction>>(
                    `/api/v1/transactions/${createdTransaction.id}`,
                    {
                        headers: authHeaders(senderToken),
                    },
                );

                return response;
            },
            (response) => response.status === 200 && response.body.data.status === 'CONFIRMED',
            30_000,
            500,
        );

        expect(confirmedTransaction.body.data.status).toBe('CONFIRMED');

        expect(confirmedTransaction.body.data.txHash).toMatch(/^0x[0-9a-fA-F]+$/);

        expect(confirmedTransaction.body.data.blockNumber).not.toBeNull();

        expect(confirmedTransaction.body.data.gasUsed).not.toBeNull();

        expect(confirmedTransaction.body.data.confirmedAt).not.toBeNull();

        /*
         * -----------------------------------------------------------
         * 10. Wait for final sender balance
         * -----------------------------------------------------------
         */

        const senderBalanceAfterTransfer = await waitFor(
            async () => {
                const response = await http<ApiResponse<Balance | null>>(
                    `/api/v1/tokens/${token.id}/balance/${fixture.sender.walletId}`,
                    {
                        headers: authHeaders(senderToken),
                    },
                );
                return response;
            },
            (response) =>
                response.status === 200 &&
                response.body.data !== null &&
                BigInt(response.body.data.balance) === 900000000n,
            30_000,
            500,
        );

        expect(BigInt(senderBalanceAfterTransfer.body.data!.balance)).toBe(900000000n);

        //
        // -----------------------------------------------------------
        // 11. Wait for final receiver balance
        // -----------------------------------------------------------
        //

        const receiverBalance = await waitFor(
            async () => {
                const response = await http<ApiResponse<Balance | null>>(
                    `/api/v1/tokens/${token.id}/balance/${fixture.receiver.walletId}`,
                    {
                        headers: authHeaders(receiverToken),
                    },
                );
                return response;
            },
            (response) =>
                response.status === 200 &&
                response.body.data !== null &&
                BigInt(response.body.data.balance) === 100000000n,
            30_000,
            500,
        );

        expect(BigInt(receiverBalance.body.data!.balance)).toBe(100000000n);
    }, 10_000);
});

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

import { http } from './helpers/http.js';
import {
    getBitcoinTransaction,
    generateBitcoinBlocks,
    getBitcoinNewAddress,
    waitForBitcoin,
} from './helpers/bitcoin.js';

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

    bitcoin: {
        senderWalletId: string;
        senderAddress: string;
        receiverWalletId: string;
        receiverAddress: string;
    };
};

type AuthResponse = {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
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

describe('Bitcoin Transaction Lifecycle E2E', () => {
    it('should complete the Bitcoin transaction lifecycle through the real HTTP API', async () => {
        const fixture = await loadFixture();

        /*
         * -----------------------------------------------------------
         * 1. Login admin
         * -----------------------------------------------------------
         */

        const adminToken = await login(fixture.admin.email, fixture.admin.password);

        expect(adminToken).toBeTruthy();

        /*
         * -----------------------------------------------------------
         * 2. Login sender
         * -----------------------------------------------------------
         */

        const senderToken = await login(fixture.sender.email, fixture.sender.password);

        /*
         * -----------------------------------------------------------
         * 3. Verify authenticated sender identity
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
         * 4. Verify Bitcoin Core is reachable
         * -----------------------------------------------------------
         */

        await waitForBitcoin();

        /*
         * -----------------------------------------------------------
         * 5. Verify Bitcoin wallets exist in the fixture
         * -----------------------------------------------------------
         */

        expect(fixture.bitcoin.senderWalletId).toBeTruthy();
        expect(fixture.bitcoin.senderAddress).toBeTruthy();
        expect(fixture.bitcoin.receiverWalletId).toBeTruthy();
        expect(fixture.bitcoin.receiverAddress).toBeTruthy();

        /*
         * -----------------------------------------------------------
         * 6. Login receiver
         * -----------------------------------------------------------
         */

        const receiverToken = await login(fixture.receiver.email, fixture.receiver.password);

        /*
         * -----------------------------------------------------------
         * 7. Submit Bitcoin transfer
         * -----------------------------------------------------------
         *
         * Bitcoin is native BTC, so there is no:
         *
         *   contract
         *   mint
         *   Transfer event
         *
         * The transaction goes through:
         *
         * HTTP API
         *     ↓
         * TransactionService
         *     ↓
         * BlockchainAdapterRegistry
         *     ↓
         * BitcoinAdapter
         *     ↓
         * Bitcoin Core
         */

        const transferResponse = await http<ApiResponse<Transaction>>('/api/v1/transactions', {
            method: 'POST',
            headers: authHeaders(senderToken),
            body: JSON.stringify({
                chain: 'BITCOIN',
                fromWalletId: fixture.bitcoin.senderWalletId,
                toWalletId: fixture.bitcoin.receiverWalletId,
                tokenId: fixture.bitcoin.tokenId,
                amount: '100000',
            }),
        });

        console.log('BITCOIN TRANSFER RESPONSE:', JSON.stringify(transferResponse, null, 2));

        expect(transferResponse.status).toBe(201);

        const createdTransaction = transferResponse.body.data;

        expect(createdTransaction.id).toBeTruthy();

        expect(['PENDING', 'SUBMITTED', 'CONFIRMING', 'CONFIRMED']).toContain(
            createdTransaction.status,
        );

        /*
         * -----------------------------------------------------------
         * 8. Wait for transaction submission
         * -----------------------------------------------------------
         */

        const submittedTransaction = await waitFor(
            async () => {
                const response = await http<ApiResponse<Transaction>>(
                    `/api/v1/transactions/${createdTransaction.id}`,
                    {
                        headers: authHeaders(senderToken),
                    },
                );

                return response;
            },
            (response) => response.status === 200 && response.body.data.txHash !== null,
        );

        const txHash = submittedTransaction.body.data.txHash!;

        /*
         * Bitcoin txids are 64 hexadecimal characters and do not
         * use the EVM 0x prefix.
         */

        expect(txHash).toMatch(/^[0-9a-fA-F]{64}$/);

        /*
         * -----------------------------------------------------------
         * 9. Verify transaction exists in Bitcoin Core
         * -----------------------------------------------------------
         *
         * The shared helper performs authenticated RPC access.
         */

        const bitcoinTransaction = await waitFor(
            () => getBitcoinTransaction(txHash),
            (transaction) => (transaction.confirmations ?? 0) >= 0,
            30_000,
            500,
        );

        expect(bitcoinTransaction.confirmations ?? 0).toBeGreaterThanOrEqual(0);

        /*
         * -----------------------------------------------------------
         * 10. Mine a regtest block
         * -----------------------------------------------------------
         *
         * Mining is deliberately deterministic on regtest.
         *
         * Use the shared authenticated helper rather than creating
         * another Bitcoin RPC implementation in this test.
         */

        const miningAddress = await getBitcoinNewAddress();

        await generateBitcoinBlocks(1, miningAddress);

        /*
         * -----------------------------------------------------------
         * 11. Wait for Bitcoin confirmation
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

        expect(confirmedTransaction.body.data.txHash).toBe(txHash);

        /*
         * BitcoinAdapter maps Bitcoin blockheight to the common
         * BlockchainTransaction.blockNumber field.
         */

        expect(confirmedTransaction.body.data.blockNumber).not.toBeNull();

        /*
         * Bitcoin has no EVM gasUsed.
         */

        expect(confirmedTransaction.body.data.gasUsed).toBeNull();

        expect(confirmedTransaction.body.data.confirmedAt).not.toBeNull();

        /*
         * -----------------------------------------------------------
         * 12. Verify Bitcoin Core sees the confirmation
         * -----------------------------------------------------------
         */

        const confirmedBitcoinTransaction = await waitFor(
            () => getBitcoinTransaction(txHash),
            (transaction) => (transaction.confirmations ?? 0) > 0,
            30_000,
            500,
        );

        expect(confirmedBitcoinTransaction.confirmations ?? 0).toBeGreaterThan(0);

        expect(confirmedBitcoinTransaction.blockhash).toBeDefined();

        /*
         * -----------------------------------------------------------
         * 13. Verify receiver identity remains accessible
         * -----------------------------------------------------------
         */

        const receiverMeResponse = await http<
            ApiResponse<{
                userId: string;
                email: string;
                role: string;
                tenantId: string;
            }>
        >('/api/v1/wallets/me', {
            headers: authHeaders(receiverToken),
        });

        expect(receiverMeResponse.status).toBe(200);
        expect(receiverMeResponse.body.data.userId).toBe(fixture.receiver.id);
        expect(receiverMeResponse.body.data.tenantId).toBe(fixture.tenant.id);

        /*
         * Admin login is intentionally retained above so this test
         * also confirms the E2E fixture's admin credentials remain
         * valid, matching the existing lifecycle test structure.
         */
        expect(adminToken).toBeTruthy();
    }, 60_000);
});

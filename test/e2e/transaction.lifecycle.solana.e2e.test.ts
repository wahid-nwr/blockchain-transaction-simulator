import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

import { http } from './helpers/http.js';
import { waitForSolana, getSolanaSignatureStatus } from './helpers/solana.js';

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

    solana: {
        tokenId: string;
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

describe('Solana Transaction Lifecycle E2E', () => {
    it('should complete the Solana transaction lifecycle through the real HTTP API', async () => {
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
         * 4. Verify the Solana test validator is reachable
         * -----------------------------------------------------------
         */

        await waitForSolana();

        /*
         * -----------------------------------------------------------
         * 5. Verify Solana wallets exist in the fixture
         * -----------------------------------------------------------
         */

        expect(fixture.solana.senderWalletId).toBeTruthy();
        expect(fixture.solana.senderAddress).toBeTruthy();
        expect(fixture.solana.receiverWalletId).toBeTruthy();
        expect(fixture.solana.receiverAddress).toBeTruthy();

        /*
         * -----------------------------------------------------------
         * 6. Login receiver
         * -----------------------------------------------------------
         */

        const receiverToken = await login(fixture.receiver.email, fixture.receiver.password);

        /*
         * -----------------------------------------------------------
         * 7. Submit Solana transfer
         * -----------------------------------------------------------
         *
         * Solana is native SOL, so — like Bitcoin — there is no:
         *
         *   contract
         *   mint
         *   Transfer event
         *
         * Unlike Bitcoin, custody is per-wallet (SolanaSignerService),
         * not delegated to the node — see ADR-011. The transaction goes
         * through:
         *
         * HTTP API
         *     ↓
         * TransactionService
         *     ↓
         * BlockchainAdapterRegistry
         *     ↓
         * SolanaAdapter
         *     ↓
         * solana-test-validator
         */

        const transferResponse = await http<ApiResponse<Transaction>>('/api/v1/transactions', {
            method: 'POST',
            headers: authHeaders(senderToken),
            body: JSON.stringify({
                chain: 'SOLANA',
                fromWalletId: fixture.solana.senderWalletId,
                toWalletId: fixture.solana.receiverWalletId,
                tokenId: fixture.solana.tokenId,
                amount: '1000000',
            }),
        });

        console.log('SOLANA TRANSFER RESPONSE:', JSON.stringify(transferResponse, null, 2));

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
         * Solana transaction signatures are base58-encoded 64-byte
         * signatures — typically 87-88 characters, no fixed length, and
         * (unlike Bitcoin/EVM hex) never contain the digit 0, uppercase O,
         * uppercase I, or lowercase l.
         */

        expect(txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/);

        /*
         * -----------------------------------------------------------
         * 9. Verify the signature independently against the validator
         * -----------------------------------------------------------
         *
         * Unlike Bitcoin regtest, solana-test-validator produces slots
         * continuously on its own — there is no equivalent of
         * generatetoaddress needed to make progress.
         */

        const solanaStatus = await waitFor(
            () => getSolanaSignatureStatus(txHash),
            (status) => status != null,
            30_000,
            500,
        );

        expect(solanaStatus).not.toBeNull();
        expect(solanaStatus?.err).toBeNull();

        /*
         * -----------------------------------------------------------
         * 10. Wait for Solana confirmation
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
         * SolanaAdapter maps the signature status's slot to the common
         * BlockchainTransaction.blockNumber field.
         */

        expect(confirmedTransaction.body.data.blockNumber).not.toBeNull();

        /*
         * Unlike Bitcoin (always null) and unlike EVM's gas, Solana
         * reports compute units consumed once confirmed — see
         * SolanaAdapter.getTransaction's second getTransaction call.
         */

        expect(confirmedTransaction.body.data.gasUsed).not.toBeNull();

        expect(confirmedTransaction.body.data.confirmedAt).not.toBeNull();

        /*
         * -----------------------------------------------------------
         * 11. Verify receiver identity remains accessible
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
         * Admin login is intentionally retained above so this test also
         * confirms the E2E fixture's admin credentials remain valid,
         * matching the existing lifecycle test structure.
         */
        expect(adminToken).toBeTruthy();
    }, 60_000);
});

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

describe('Transaction API E2E', () => {
    it('should require authentication', async () => {
        const response = await http('/api/v1/transactions', {
            method: 'POST',
            body: JSON.stringify({
                tokenId: randomUUID(),
                fromWalletId: randomUUID(),
                toWalletId: randomUUID(),
                amount: '100',
            }),
        });

        expect(response.status).toBe(401);
    });

    it('should reject an invalid transaction payload', async () => {
        const fixture = await loadFixture();

        const senderToken = await login(fixture.sender.email, fixture.sender.password);

        const response = await http('/api/v1/transactions', {
            method: 'POST',
            headers: authHeaders(senderToken),
            body: JSON.stringify({
                tokenId: 'not-a-uuid',
                fromWalletId: fixture.sender.walletId,
                toWalletId: fixture.receiver.walletId,
                amount: '0',
            }),
        });

        expect(response.status).toBe(400);
    });

    it('should reject a negative transaction amount', async () => {
        const fixture = await loadFixture();

        const senderToken = await login(fixture.sender.email, fixture.sender.password);

        const response = await http('/api/v1/transactions', {
            method: 'POST',
            headers: authHeaders(senderToken),
            body: JSON.stringify({
                tokenId: randomUUID(),
                fromWalletId: fixture.sender.walletId,
                toWalletId: fixture.receiver.walletId,
                amount: '-100',
            }),
        });

        expect(response.status).toBe(400);
    });

    it('should reject an invalid amount format', async () => {
        const fixture = await loadFixture();

        const senderToken = await login(fixture.sender.email, fixture.sender.password);

        const response = await http('/api/v1/transactions', {
            method: 'POST',
            headers: authHeaders(senderToken),
            body: JSON.stringify({
                tokenId: randomUUID(),
                fromWalletId: fixture.sender.walletId,
                toWalletId: fixture.receiver.walletId,
                amount: '1.5',
            }),
        });

        expect(response.status).toBe(400);
    });

    it('should reject access to another tenant transaction', async () => {
        const fixture = await loadFixture();

        const senderToken = await login(fixture.sender.email, fixture.sender.password);

        const response = await http<ApiResponse<Transaction>>(
            `/api/v1/transactions/${randomUUID()}`,
            {
                headers: authHeaders(senderToken),
            },
        );

        expect([403, 404]).toContain(response.status);
    });

    it('should reject a transfer from a wallet the user does not own', async () => {
        const fixture = await loadFixture();

        const receiverToken = await login(fixture.receiver.email, fixture.receiver.password);

        const response = await http('/api/v1/transactions', {
            method: 'POST',
            headers: authHeaders(receiverToken),
            body: JSON.stringify({
                tokenId: randomUUID(),
                fromWalletId: fixture.sender.walletId,
                toWalletId: fixture.receiver.walletId,
                amount: '100',
            }),
        });

        expect([403, 404]).toContain(response.status);
    });

    it('should return 404 for a transaction that does not exist', async () => {
        const fixture = await loadFixture();

        const senderToken = await login(fixture.sender.email, fixture.sender.password);

        const response = await http<ApiResponse<Transaction>>(
            `/api/v1/transactions/${randomUUID()}`,
            {
                headers: authHeaders(senderToken),
            },
        );

        expect(response.status).toBe(404);
    });
});

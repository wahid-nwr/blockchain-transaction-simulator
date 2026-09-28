import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';

import { http } from './helpers/http.js';
import {
    getBitcoinAddressBalance,
    getBitcoinBlockHeight,
    waitForBitcoin,
} from './helpers/bitcoin.js';
import { getSolanaBalanceAndSlot, waitForSolana } from './helpers/solana.js';

const FIXTURE_FILE = process.env.E2E_FIXTURE_FILE ?? '/tmp/blockchain-e2e/fixtures.json';
const E2E_DATABASE_URL =
    process.env.E2E_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:65433/blockchain_simulator_e2e';

const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });

type ApiResponse<T> = {
    data: T;
    requestId: string;
};

type Fixture = {
    admin: { email: string; password: string };
    sender: { id: string; email: string; password: string };
    bitcoin: {
        tokenId: string;
        senderWalletId: string;
        senderAddress: string;
    };
    solana: {
        tokenId: string;
        senderWalletId: string;
        senderAddress: string;
    };
};

type AuthResponse = {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
};

type ReconciliationResponse = {
    status: 'MATCH' | 'MISMATCH' | 'STALE_OBSERVATION';
    blockchain: string;
    walletId: string;
    tokenId: string;
    persisted: { balance: string; blockNumber: string } | null;
    chain: { balance: string; blockNumber: string };
};

async function loadFixture(): Promise<Fixture> {
    return JSON.parse(await readFile(FIXTURE_FILE, 'utf8')) as Fixture;
}

async function login(email: string, password: string): Promise<string> {
    const response = await http<ApiResponse<AuthResponse>>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });

    expect(response.status).toBe(200);
    return response.body.data.accessToken;
}

async function reconcile(tokenId: string, walletId: string, accessToken: string) {
    return http<ApiResponse<ReconciliationResponse>>(
        `/api/v1/tokens/${tokenId}/balance/${walletId}/reconcile`,
        { headers: { authorization: `Bearer ${accessToken}` } },
    );
}

describe('Balance Reconciliation Multichain E2E', () => {
    it('reconciles the real Bitcoin balance through the HTTP API', async () => {
        const fixture = await loadFixture();
        await waitForBitcoin();

        const accessToken = await login(fixture.sender.email, fixture.sender.password);
        const balance = await getBitcoinAddressBalance(fixture.bitcoin.senderAddress);
        const blockNumber = await getBitcoinBlockHeight();

        await prisma.balanceSnapshot.upsert({
            where: {
                walletId_tokenId: {
                    walletId: fixture.bitcoin.senderWalletId,
                    tokenId: fixture.bitcoin.tokenId,
                },
            },
            create: {
                walletId: fixture.bitcoin.senderWalletId,
                tokenId: fixture.bitcoin.tokenId,
                balance,
                blockNumber,
            },
            update: { balance, blockNumber },
        });

        const response = await reconcile(
            fixture.bitcoin.tokenId,
            fixture.bitcoin.senderWalletId,
            accessToken,
        );

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
            status: 'MATCH',
            blockchain: 'BITCOIN',
            walletId: fixture.bitcoin.senderWalletId,
            tokenId: fixture.bitcoin.tokenId,
            persisted: {
                balance: balance.toString(),
                blockNumber: blockNumber.toString(),
            },
        });
        expect(BigInt(response.body.data.chain.balance)).toBe(balance);
        expect(BigInt(response.body.data.chain.blockNumber)).toBeGreaterThanOrEqual(blockNumber);
    });

    it('reconciles the real Solana balance through the HTTP API', async () => {
        const fixture = await loadFixture();
        await waitForSolana();

        const accessToken = await login(fixture.sender.email, fixture.sender.password);
        const observed = await getSolanaBalanceAndSlot(new PublicKey(fixture.solana.senderAddress));

        await prisma.balanceSnapshot.upsert({
            where: {
                walletId_tokenId: {
                    walletId: fixture.solana.senderWalletId,
                    tokenId: fixture.solana.tokenId,
                },
            },
            create: {
                walletId: fixture.solana.senderWalletId,
                tokenId: fixture.solana.tokenId,
                balance: observed.balance,
                blockNumber: observed.slot,
            },
            update: { balance: observed.balance, blockNumber: observed.slot },
        });

        const response = await reconcile(
            fixture.solana.tokenId,
            fixture.solana.senderWalletId,
            accessToken,
        );

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
            status: 'MATCH',
            blockchain: 'SOLANA',
            walletId: fixture.solana.senderWalletId,
            tokenId: fixture.solana.tokenId,
            persisted: {
                balance: observed.balance.toString(),
                blockNumber: observed.slot.toString(),
            },
        });
        expect(BigInt(response.body.data.chain.balance)).toBe(observed.balance);
        expect(BigInt(response.body.data.chain.blockNumber)).toBeGreaterThanOrEqual(observed.slot);
    });
});

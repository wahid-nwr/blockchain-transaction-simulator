import { describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

import { SolanaAdapter } from '../../../src/blockchain/solana/solana.adapter.js';
import type { BlockchainAdapter } from '../../../src/blockchain/blockchain-adapter.js';

// A valid base58, 32-byte value works as a stand-in blockhash for wire
// serialization purposes — the adapter never validates that it came from
// a real recent block, it just needs something that decodes to 32 bytes.
const FAKE_BLOCKHASH = Keypair.generate().publicKey.toBase58();

function makeSigner(keypair: Keypair) {
    return { getKeypairFor: vi.fn().mockResolvedValue(keypair) } as never;
}

describe('SolanaAdapter', () => {
    it('rejects every asset identifier — Solana has no token/contract layer', () => {
        const adapter = new SolanaAdapter(() => ({}) as never, { getKeypairFor: vi.fn() } as never);

        expect(adapter.validateAssetIdentifier(Keypair.generate().publicKey.toBase58())).toBe(
            false,
        );
        expect(adapter.validateAssetIdentifier('')).toBe(false);
    });

    it('has no mint capability', () => {
        const adapter: BlockchainAdapter = new SolanaAdapter(() => ({}) as never, {
            getKeypairFor: vi.fn(),
        } as never);

        expect(adapter.mint).toBeUndefined();
    });

    it('reads the native SOL balance and reports the RPC context slot', async () => {
        const wallet = Keypair.generate().publicKey;
        const connection = {
            getBalanceAndContext: vi.fn().mockResolvedValue({
                context: { slot: 250 },
                value: 5_000_000,
            }),
        };

        const adapter = new SolanaAdapter(
            () => connection as never,
            makeSigner(Keypair.generate()),
        );

        await expect(
            adapter.getTokenBalance({ walletAddress: wallet.toBase58() }),
        ).resolves.toEqual({
            balance: 5_000_000n,
            blockNumber: 250n,
        });

        expect(connection.getBalanceAndContext).toHaveBeenCalledWith(wallet, 'confirmed');
    });

    it('uses a requested slot as the minimum Solana observation context', async () => {
        const wallet = Keypair.generate().publicKey;
        const connection = {
            getBalanceAndContext: vi.fn().mockResolvedValue({
                context: { slot: 250 },
                value: 5_000_000,
            }),
        };

        const adapter = new SolanaAdapter(
            () => connection as never,
            makeSigner(Keypair.generate()),
        );

        await adapter.getTokenBalance({
            walletAddress: wallet.toBase58(),
            blockNumber: 200n,
        });

        expect(connection.getBalanceAndContext).toHaveBeenCalledWith(wallet, {
            commitment: 'confirmed',
            minContextSlot: 200,
        });
    });

    it('rejects a Solana asset identifier because reconciliation supports native SOL only', async () => {
        const connection = { getBalanceAndContext: vi.fn() };
        const adapter = new SolanaAdapter(
            () => connection as never,
            makeSigner(Keypair.generate()),
        );

        await expect(
            adapter.getTokenBalance({
                walletAddress: Keypair.generate().publicKey.toBase58(),
                assetIdentifier: 'SomeMint',
            }),
        ).rejects.toThrow('native SOL asset only');

        expect(connection.getBalanceAndContext).not.toHaveBeenCalled();
    });

    it('submits a transfer using lamports directly', async () => {
        const fromKeypair = Keypair.generate();
        const toKeypair = Keypair.generate();

        const connection = {
            getLatestBlockhash: vi.fn().mockResolvedValue({
                blockhash: FAKE_BLOCKHASH,
                lastValidBlockHeight: 1000,
            }),
            sendRawTransaction: vi.fn().mockResolvedValue('solana-tx-signature'),
        };

        const adapter = new SolanaAdapter(() => connection as never, makeSigner(fromKeypair));

        const result = await adapter.submitTransfer({
            tenantId: 'tenant-1',
            walletId: 'wallet-1',
            toAddress: toKeypair.publicKey.toBase58(),
            amount: 5_000_000n,
        });

        expect(result).toEqual({ txHash: 'solana-tx-signature' });
        expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a negative amount without calling the connection', async () => {
        const fromKeypair = Keypair.generate();
        const connection = {
            getLatestBlockhash: vi.fn(),
            sendRawTransaction: vi.fn(),
        };

        const adapter = new SolanaAdapter(() => connection as never, makeSigner(fromKeypair));

        await expect(
            adapter.submitTransfer({
                tenantId: 'tenant-1',
                walletId: 'wallet-1',
                toAddress: Keypair.generate().publicKey.toBase58(),
                amount: -1n,
            }),
        ).rejects.toThrow('Solana transfer amount cannot be negative');

        expect(connection.getLatestBlockhash).not.toHaveBeenCalled();
    });

    it('maps a signature not yet visible to the node as pending', async () => {
        const connection = {
            getSignatureStatuses: vi.fn().mockResolvedValue({ value: [null] }),
        };

        const adapter = new SolanaAdapter(
            () => connection as never,
            makeSigner(Keypair.generate()),
        );

        await expect(adapter.getTransaction('sig')).resolves.toEqual({
            txHash: 'sig',
            blockNumber: null,
            confirmations: 0,
            status: 'pending',
            gasUsed: null,
        });
    });

    it("maps 'processed' (seen, not yet voted on) as pending, preserving confirmationLevel", async () => {
        const connection = {
            getSignatureStatuses: vi.fn().mockResolvedValue({
                value: [{ slot: 42, confirmations: 1, err: null, confirmationStatus: 'processed' }],
            }),
            getTransaction: vi.fn(),
        };

        const adapter = new SolanaAdapter(
            () => connection as never,
            makeSigner(Keypair.generate()),
        );

        await expect(adapter.getTransaction('sig')).resolves.toEqual({
            txHash: 'sig',
            blockNumber: 42n,
            confirmations: 1,
            status: 'pending',
            gasUsed: null,
            confirmationLevel: 'processed',
        });

        // 'processed' is not confirmed-or-finalized, so the compute-units
        // detail call must not fire — same "second call only once
        // confirmed" discipline as the Bitcoin adapter's getblockheader.
        expect(connection.getTransaction).not.toHaveBeenCalled();
    });

    it("maps 'confirmed' as confirmed and fetches compute units consumed", async () => {
        const connection = {
            getSignatureStatuses: vi.fn().mockResolvedValue({
                value: [
                    { slot: 42, confirmations: 12, err: null, confirmationStatus: 'confirmed' },
                ],
            }),
            getTransaction: vi.fn().mockResolvedValue({
                meta: { computeUnitsConsumed: 1500 },
            }),
        };

        const adapter = new SolanaAdapter(
            () => connection as never,
            makeSigner(Keypair.generate()),
        );

        await expect(adapter.getTransaction('sig')).resolves.toEqual({
            txHash: 'sig',
            blockNumber: 42n,
            confirmations: 12,
            status: 'confirmed',
            gasUsed: 1500n,
            confirmationLevel: 'confirmed',
        });
    });

    it("maps 'finalized' as confirmed too — ConfirmationProcessor only needs final-and-good, not the finer distinction", async () => {
        const connection = {
            getSignatureStatuses: vi.fn().mockResolvedValue({
                value: [
                    { slot: 42, confirmations: null, err: null, confirmationStatus: 'finalized' },
                ],
            }),
            getTransaction: vi.fn().mockResolvedValue({ meta: { computeUnitsConsumed: 1500 } }),
        };

        const adapter = new SolanaAdapter(
            () => connection as never,
            makeSigner(Keypair.generate()),
        );

        const result = await adapter.getTransaction('sig');

        expect(result.status).toBe('confirmed');
        expect(result.confirmationLevel).toBe('finalized');
    });

    it('maps a transaction with an error as failed, without fetching compute units', async () => {
        const connection = {
            getSignatureStatuses: vi.fn().mockResolvedValue({
                value: [
                    {
                        slot: 42,
                        confirmations: 0,
                        err: { InstructionError: [0, 'Custom'] },
                        confirmationStatus: 'confirmed',
                    },
                ],
            }),
            getTransaction: vi.fn(),
        };

        const adapter = new SolanaAdapter(
            () => connection as never,
            makeSigner(Keypair.generate()),
        );

        await expect(adapter.getTransaction('sig')).resolves.toEqual({
            txHash: 'sig',
            blockNumber: 42n,
            confirmations: 0,
            status: 'failed',
            gasUsed: null,
            confirmationLevel: 'confirmed',
        });

        expect(connection.getTransaction).not.toHaveBeenCalled();
    });

    describe('custody', () => {
        const adapter = () =>
            new SolanaAdapter(() => ({}) as never, { getKeypairFor: vi.fn() } as never);

        it('can sign only a CUSTODIAL wallet that has a custody key', () => {
            expect(adapter().canSign({ custodyType: 'CUSTODIAL', hasCustodyKey: true })).toBe(true);
            expect(adapter().canSign({ custodyType: 'CUSTODIAL', hasCustodyKey: false })).toBe(
                false,
            );
            expect(adapter().canSign({ custodyType: 'EXTERNAL', hasCustodyKey: false })).toBe(
                false,
            );
        });

        it('generates a keypair in the plain-hex format SolanaSignerService parses', async () => {
            const { address, secret } = await adapter().createCustodialWallet();

            expect(secret).toMatch(/^[0-9a-f]{128}$/);

            // Same parse as SolanaSignerService.getKeypairFor.
            const restored = Keypair.fromSecretKey(Buffer.from(secret, 'hex'));
            expect(restored.publicKey.toBase58()).toBe(address);
        });
    });
});

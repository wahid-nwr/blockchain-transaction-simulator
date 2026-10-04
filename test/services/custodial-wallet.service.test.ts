import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { privateKeyToAccount } from 'viem/accounts';

import { CustodialWalletService } from '../../src/services/custodial-wallet.service.js';
import { BlockchainAdapterRegistry } from '../../src/blockchain/blockchain-adapter.registry.js';
import { EvmAdapter } from '../../src/blockchain/evm/evm.adapter.js';
import { SolanaAdapter } from '../../src/blockchain/solana/solana.adapter.js';
import { BitcoinAdapter } from '../../src/blockchain/bitcoin/bitcoin.adapter.js';
import {
    ANVIL_CHAIN_ID,
    BITCOIN_REGTEST_CHAIN_ID,
    SOLANA_LOCALNET_CHAIN_ID,
} from '../../src/blockchain/wallet-address.js';
import { decryptWalletKey } from '../../src/crypto/envelope.js';

// Relies on the ambient KMS_PROVIDER=local / LOCAL_KMS_MASTER_KEY from .env.test.
// Tests that need a different KMS config stub it and restore it in afterEach.

describe('CustodialWalletService', () => {
    const repositoryMock = {
        createCustodial: vi.fn(),
    };

    let service: CustodialWalletService;

    const owner = { tenantId: 'tenant-1', ownerId: 'user-1' };

    beforeEach(() => {
        vi.clearAllMocks();

        // Echo the row back, as Prisma would (scalars only, no key relation).
        repositoryMock.createCustodial.mockImplementation(async (data: any) => ({
            id: 'wallet-1',
            tenantId: data.tenantId,
            ownerId: data.ownerId,
            chainId: data.chainId,
            address: data.address,
            custodyType: 'CUSTODIAL',
        }));

        const registry = new BlockchainAdapterRegistry([
            new EvmAdapter({ getWalletClientFor: vi.fn() } as never, { mint: vi.fn() } as never),
            new BitcoinAdapter({ call: vi.fn() } as never),
            new SolanaAdapter(() => ({}) as never, { getKeypairFor: vi.fn() } as never),
        ]);

        service = new CustodialWalletService(repositoryMock as never, registry);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('creates an EVM wallet whose stored ciphertext decrypts to the key behind its address', async () => {
        const wallet = await service.createCustodialWallet({ ...owner, chainId: ANVIL_CHAIN_ID });

        expect(repositoryMock.createCustodial).toHaveBeenCalledTimes(1);
        const stored = repositoryMock.createCustodial.mock.calls[0][0];

        expect(stored).toMatchObject({ ...owner, chainId: ANVIL_CHAIN_ID });

        // What was persisted is ciphertext, and it round-trips to a key that
        // really controls the stored address — i.e. it is signable later.
        const secret = await decryptWalletKey(stored.encryptedKey, stored.kmsKeyId);
        expect(privateKeyToAccount(secret as `0x${string}`).address).toBe(stored.address);
        expect(Buffer.from(stored.encryptedKey).toString('utf8')).not.toContain(secret);

        expect(wallet.custodyType).toBe('CUSTODIAL');
    });

    it('creates a Solana wallet in the hex format SolanaSignerService reads back', async () => {
        await service.createCustodialWallet({ ...owner, chainId: SOLANA_LOCALNET_CHAIN_ID });

        const stored = repositoryMock.createCustodial.mock.calls[0][0];
        const secret = await decryptWalletKey(stored.encryptedKey, stored.kmsKeyId);

        expect(Keypair.fromSecretKey(Buffer.from(secret, 'hex')).publicKey.toBase58()).toBe(
            stored.address,
        );
    });

    it('never hands key material back to the caller', async () => {
        const wallet = await service.createCustodialWallet({ ...owner, chainId: ANVIL_CHAIN_ID });
        const serialized = JSON.stringify(wallet);
        const stored = repositoryMock.createCustodial.mock.calls[0][0];
        const secret = await decryptWalletKey(stored.encryptedKey, stored.kmsKeyId);

        expect(serialized).not.toContain(secret);
        expect(wallet).not.toHaveProperty('secret');
        expect(wallet).not.toHaveProperty('encryptedKey');
        expect(wallet).not.toHaveProperty('custodyKey');
    });

    it('rejects an unknown chainId before generating anything', async () => {
        await expect(service.createCustodialWallet({ ...owner, chainId: 1 })).rejects.toMatchObject(
            { code: 'UNSUPPORTED_CHAIN', statusCode: 400 },
        );

        expect(repositoryMock.createCustodial).not.toHaveBeenCalled();
    });

    it('reports UNSUPPORTED_CHAIN_CAPABILITY for a chain with no per-wallet custody (Bitcoin)', async () => {
        await expect(
            service.createCustodialWallet({ ...owner, chainId: BITCOIN_REGTEST_CHAIN_ID }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CHAIN_CAPABILITY', statusCode: 400 });

        expect(repositoryMock.createCustodial).not.toHaveBeenCalled();
    });

    it('records the configured KMS key id on the new key row', async () => {
        vi.stubEnv('KMS_KEY_ID', 'alias/wallet-keys');

        await service.createCustodialWallet({ ...owner, chainId: ANVIL_CHAIN_ID });

        expect(repositoryMock.createCustodial.mock.calls[0][0].kmsKeyId).toBe('alias/wallet-keys');
    });

    it('fails before generating a key when real KMS is selected without a KMS_KEY_ID', async () => {
        vi.stubEnv('KMS_PROVIDER', 'aws');
        vi.stubEnv('KMS_KEY_ID', '');

        const generate = vi.spyOn(EvmAdapter.prototype, 'createCustodialWallet');

        await expect(
            service.createCustodialWallet({ ...owner, chainId: ANVIL_CHAIN_ID }),
        ).rejects.toThrow(/KMS_KEY_ID is not set/);

        expect(generate).not.toHaveBeenCalled();
        expect(repositoryMock.createCustodial).not.toHaveBeenCalled();

        generate.mockRestore();
    });
});

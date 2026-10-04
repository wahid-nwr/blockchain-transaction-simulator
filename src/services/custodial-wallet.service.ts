import { encryptWalletKey, getWalletKmsKeyId } from '../crypto/envelope.js';
import { blockchainForChainId } from '../blockchain/wallet-address.js';
import type { BlockchainAdapterRegistry } from '../blockchain/blockchain-adapter.registry.js';
import { WalletRepository } from '../repositories/wallet.repository.js';
import { Errors } from '../common/errors/errors.js';

/**
 * Creates platform-held (CUSTODIAL) wallets: the platform generates the
 * keypair, encrypts the secret straight into the envelope, and stores only
 * ciphertext. Previously the only way to get a wallet the platform could sign
 * for was writing a key row directly to the database (test factories) — see
 * ADR-011 and ADR-013.
 */
export class CustodialWalletService {
    constructor(
        private readonly repository: WalletRepository,
        private readonly registry: BlockchainAdapterRegistry,
    ) {}

    async createCustodialWallet(data: { tenantId: string; ownerId: string; chainId: number }) {
        const blockchain = blockchainForChainId(data.chainId);

        if (!blockchain) {
            throw Errors.unsupportedChain(data.chainId);
        }

        const adapter = this.registry.get(blockchain);

        if (!adapter.createCustodialWallet) {
            throw Errors.unsupportedChainCapability('custodial wallet creation', blockchain);
        }

        // Resolved before generating anything, so a misconfigured KMS key id
        // fails without ever holding fresh key material.
        const kmsKeyId = getWalletKmsKeyId();

        const { address, secret } = await adapter.createCustodialWallet();

        // Uint8Array.from copies into a plain-ArrayBuffer-backed array, which
        // is the narrower type Prisma's Bytes fields require.
        const encryptedKey = Uint8Array.from(await encryptWalletKey(secret, kmsKeyId));

        // A freshly generated address cannot realistically collide, so no
        // "already registered" pre-check; the unique constraint still
        // backstops it.
        return this.repository.createCustodial({
            tenantId: data.tenantId,
            ownerId: data.ownerId,
            chainId: data.chainId,
            address,
            encryptedKey,
            kmsKeyId,
        });
    }
}

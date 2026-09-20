import { Keypair } from '@solana/web3.js';

import { WalletRepository } from '../repositories/wallet.repository.js';
import { decryptWalletKey } from '../crypto/envelope.js';
import { Errors } from '../common/errors/errors.js';
import { CustodyType } from '@prisma/client';

export class SolanaSignerService {
    constructor(private readonly walletRepository: WalletRepository) {}

    async getKeypairFor(walletId: string, tenantId: string): Promise<Keypair> {
        const wallet = await this.walletRepository.findByIdForTenantWithCustody(walletId, tenantId);

        if (!wallet) throw Errors.walletNotFound();
        if (wallet.custodyType !== CustodyType.CUSTODIAL || !wallet.custodyKey) {
            throw Errors.walletNotCustodial();
        }

        const secretKeyHex = await decryptWalletKey(
            wallet.custodyKey.encryptedKey,
            wallet.custodyKey.kmsKeyId,
        );

        // Stored as a plain (no "0x" prefix) hex-encoded 64-byte Ed25519
        // secret key — not base58, which is the format Solana wallets
        // conventionally export/import. There's no need to match that
        // convention here: this key never leaves the envelope-encryption
        // boundary to be pasted into an external wallet, so hex was kept
        // for consistency with how the EVM signer stores its key, rather
        // than adding a base58 dependency for a format nothing else in
        // this codebase needs. See ADR-011.
        return Keypair.fromSecretKey(Buffer.from(secretKeyHex, 'hex'));
    }
}

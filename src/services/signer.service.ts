import { WalletRepository } from '../repositories/wallet.repository.js';
import { decryptWalletKey } from '../crypto/envelope.js';
import { getWalletClient } from '../blockchain/client.js';
import { Errors } from '../common/errors/errors.js';
import { CustodyType } from '@prisma/client';
import type { Hex } from 'viem';

export class SignerService {
    constructor(private readonly walletRepository: WalletRepository) {}

    async getWalletClientFor(walletId: string, tenantId: string) {
        const wallet = await this.walletRepository.findByIdForTenantWithCustody(walletId, tenantId);

        if (!wallet) throw Errors.walletNotFound();
        if (wallet.custodyType !== CustodyType.CUSTODIAL || !wallet.custodyKey) {
            throw Errors.walletNotCustodial();
        }

        const privateKey = await decryptWalletKey(
            wallet.custodyKey.encryptedKey,
            wallet.custodyKey.kmsKeyId,
        );

        return getWalletClient(privateKey as Hex);
    }
}

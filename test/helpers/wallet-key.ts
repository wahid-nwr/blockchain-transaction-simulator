import { prisma } from '../../src/database/prisma.js';
import { encryptWalletKey } from '../../src/crypto/envelope.js';
import type { Hex } from 'viem';

// Attaches a WalletCustodyKey to an existing wallet, encrypted via the
// KMS_PROVIDER=local envelope configured in .env.test — never touches real AWS.
export async function attachCustodyKey(walletId: string, privateKey: Hex, kmsKeyId = 'test-key') {
    // Buffer's `buffer` property is typed as ArrayBufferLike (which includes
    // SharedArrayBuffer), but Prisma's Bytes fields want Uint8Array<ArrayBuffer>
    // specifically. Uint8Array.from() copies into a fresh, plain-ArrayBuffer-backed
    // Uint8Array, which satisfies that narrower type.
    const encryptedKey = Uint8Array.from(await encryptWalletKey(privateKey, kmsKeyId));

    return prisma.walletCustodyKey.create({
        data: {
            walletId,
            encryptedKey,
            kmsKeyId,
        },
    });
}

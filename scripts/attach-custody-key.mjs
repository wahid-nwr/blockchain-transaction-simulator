// Makes a wallet CUSTODIAL and attaches an encrypted custody key.
// Runs INSIDE the API container so it uses the container's DATABASE_URL and LOCAL_KMS_MASTER_KEY:
//
//   docker exec -i -e WALLET_ID=<id> -e PRIVATE_KEY_HEX=<0x...> <api-container> \
//     node --input-type=module - < attach-custody-key.mjs
//
// Assumes the compiled code lives in /app/dist (as in your stack traces).
import { PrismaClient } from '@prisma/client';
import { encryptWalletKey } from 'file:///app/dist/crypto/envelope.js';

const walletId = process.env.WALLET_ID;
const privateKey = process.env.PRIVATE_KEY_HEX;
const kmsKeyId = process.env.KMS_KEY_ID ?? 'test-key';

if (!walletId || !privateKey) {
    throw new Error('WALLET_ID and PRIVATE_KEY_HEX are required');
}

const prisma = new PrismaClient();

try {
    const encryptedKey = Uint8Array.from(await encryptWalletKey(privateKey, kmsKeyId));

    await prisma.$transaction([
        prisma.wallet.update({
            where: { id: walletId },
            data: { custodyType: 'CUSTODIAL' },
        }),
        // Replace any existing key so the script can be re-run safely.
        prisma.walletCustodyKey.deleteMany({ where: { walletId } }),
        prisma.walletCustodyKey.create({
            data: { walletId, encryptedKey, kmsKeyId },
        }),
    ]);

    console.log(`Wallet ${walletId} is now CUSTODIAL with a custody key.`);
} finally {
    await prisma.$disconnect();
}

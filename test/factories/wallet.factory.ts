import { prisma } from '../../src/database/prisma.js';
import { randomUUID } from 'crypto';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { attachCustodyKey } from '../helpers/wallet-key.js';
import { fundAccount } from '../helpers/anvil.js';
import type { Hex } from 'viem';

export async function createWallet(overrides: any = {}) {
    return prisma.wallet.create({
        data: {
            tenantId: overrides.tenantId,
            ownerId: overrides.ownerId,
            chainId: overrides.chainId ?? 31337,
            address: overrides.address ?? `0x${keccak256(toHex(randomUUID())).slice(2, 42)}`,
            custodyType: overrides.custodyType ?? 'EXTERNAL',
        },
    });
}

// Creates a CUSTODIAL wallet with a real (locally-encrypted, test-only) signing
// key attached — use this whenever a test needs to actually submit a transfer.
//
// Generates a fresh private key per call by default (rather than reusing a
// fixed ANVIL_ACCOUNTS entry) since Wallet.address is unique in the DB —
// reusing one key across multiple calls collides as soon as this is called
// more than once in a run. The freshly generated key is funded via Anvil's
// setBalance cheat code so it can still pay gas for real on-chain calls.
export async function createCustodialWallet(overrides: any = {}) {
    const privateKey: Hex = overrides.privateKey ?? generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    if (!overrides.privateKey) {
        await fundAccount(account.address);
    }

    const wallet = await createWallet({
        ...overrides,
        address: overrides.address ?? account.address,
        custodyType: 'CUSTODIAL',
    });

    await attachCustodyKey(wallet.id, privateKey);

    return wallet;
}

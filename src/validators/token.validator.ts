import { z } from 'zod';
import { Blockchain } from '@prisma/client';

export const registerTokenSchema = z.object({
    tokenId: z.string().uuid(),
    name: z.string().min(1),
    symbol: z.string().min(1),
    contractAddress: z.string().min(1),
    decimals: z.number().int().positive().default(6),
    // Real format validation (is this a well-formed EVM address, and
    // nothing yet for Bitcoin/Solana) happens per-chain in TokenService
    // via BlockchainAdapter.validateAssetIdentifier, not here — this
    // schema only checks that a recognized chain was named. See ADR-012.
    blockchain: z.nativeEnum(Blockchain).default(Blockchain.EVM),
});

export const mintTokenSchema = z.object({
    // Chain-specific receiver format (EVM `isAddress`, etc.) is validated
    // inside the resolved adapter's `mint`, not here — mirrors how
    // createWalletSchema leaves wallet address format to the service
    // layer, so this schema doesn't need to know which chain a token is
    // on. See ADR-012.
    receiver: z.string().min(1),
    amount: z.string().refine((value) => {
        try {
            return BigInt(value) > 0n;
        } catch {
            return false;
        }
    }, 'Invalid amount'),
});

import { z } from 'zod';
import { Blockchain } from '@prisma/client';

export const registerTokenSchema = z.object({
    tokenId: z.string().uuid(),
    name: z.string().min(1),
    symbol: z.string().min(1),
    // Native Bitcoin/Solana assets have no contract address. EVM tokens
    // still require one at the service layer.
    contractAddress: z.string().min(1).optional(),
    decimals: z.number().int().positive().default(6),
    // EVM format validation happens per-chain in TokenService; native
    // Bitcoin/Solana assets deliberately have no asset identifier.
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

export const reconcileTokenBalanceParamsSchema = z.object({
    tokenId: z.string(),
    walletId: z.string(),
});

export const reconcileTokenBalanceQuerySchema = z.object({
    // The chain's monotonic observation position — a block number on EVM,
    // a height on Bitcoin, a slot on Solana. Optional: omitted means
    // "reconcile against the latest chain state", and the response's
    // `chain.blockNumber` reports the position actually observed.
    blockNumber: z
        .string()
        .regex(/^[0-9]+$/, 'Invalid block number')
        .optional(),
});

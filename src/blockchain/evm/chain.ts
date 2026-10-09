import { defineChain, type Chain } from 'viem';
import { foundry, robinhood, robinhoodTestnet } from 'viem/chains';
import {
    ANVIL_CHAIN_ID,
    BITCOIN_REGTEST_CHAIN_ID,
    SOLANA_LOCALNET_CHAIN_ID,
} from '../chain-ids.js';

/**
 * The single EVM chain this deployment talks to.
 *
 * The platform is wired to ONE EVM chain at a time: every viem client, the
 * event indexer and wallet validation all derive it from `EVM_CHAIN_ID`
 * (default 31337, a local Anvil node). To run against another network,
 * set both `EVM_CHAIN_ID` and `RPC_URL`, e.g. for Robinhood Chain testnet:
 *
 *   EVM_CHAIN_ID=46630
 *   RPC_URL=https://rpc.testnet.chain.robinhood.com
 *
 * The chain ID matters beyond bookkeeping: viem signs every transaction for
 * `chain.id`, and a node rejects a transaction signed for a different chain.
 */

const KNOWN_CHAINS: Readonly<Record<number, Chain>> = {
    // viem's `foundry` is id 31337 (Anvil's default); its `localhost` is 1337.
    [foundry.id]: foundry,
    [robinhoodTestnet.id]: robinhoodTestnet,
    [robinhood.id]: robinhood,
};

// A Wallet's numeric chainId selects its blockchain, so an EVM chain ID that
// equals a non-EVM sentinel would make one of the two unreachable.
const RESERVED_CHAIN_IDS: ReadonlySet<number> = new Set([
    BITCOIN_REGTEST_CHAIN_ID,
    SOLANA_LOCALNET_CHAIN_ID,
]);

/**
 * Parse and validate `EVM_CHAIN_ID`. Throws on a malformed value so a
 * misconfigured deployment fails at startup instead of signing for the
 * wrong chain.
 */
export function getEvmChainId(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.EVM_CHAIN_ID?.trim();

    if (!raw) {
        return ANVIL_CHAIN_ID;
    }

    const chainId = Number(raw);

    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(chainId)) {
        throw new Error(`Invalid EVM_CHAIN_ID "${raw}": expected a positive integer`);
    }

    if (RESERVED_CHAIN_IDS.has(chainId)) {
        throw new Error(
            `Invalid EVM_CHAIN_ID ${chainId}: collides with a reserved non-EVM chain id`,
        );
    }

    return chainId;
}

/**
 * The viem `Chain` for the configured EVM chain. Chains viem already knows
 * (Anvil, Robinhood Chain mainnet/testnet) use viem's own definition; any
 * other ID gets a minimal generic definition, which is enough for
 * signing, since only `id` is required.
 */
export function getEvmChain(env: NodeJS.ProcessEnv = process.env): Chain {
    const chainId = getEvmChainId(env);

    return (
        KNOWN_CHAINS[chainId] ??
        defineChain({
            id: chainId,
            name: `EVM chain ${chainId}`,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: { default: { http: env.RPC_URL ? [env.RPC_URL] : [] } },
        })
    );
}

/** True if `chainId` is the EVM chain this deployment is configured for. */
export function isEvmChainId(chainId: number, env: NodeJS.ProcessEnv = process.env): boolean {
    return chainId === getEvmChainId(env);
}

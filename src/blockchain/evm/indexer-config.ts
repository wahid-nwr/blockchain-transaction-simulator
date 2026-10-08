/**
 * Tuning for the ERC-20 `Transfer` log indexer (workers/event.listener.ts).
 *
 * The defaults reproduce the original behaviour on a local Anvil node
 * (start at genesis, no confirmation lag) while keeping every request bounded,
 * which a public RPC requires. All values are parsed strictly: a typo should
 * stop the worker at startup, not silently fall back to a default that scans
 * the wrong range.
 */
export interface EvmIndexerConfig {
    /** First block to index for a token that has never been indexed. */
    startBlock: bigint;
    /** Only index blocks at least this many behind the chain head. */
    confirmations: bigint;
    /** Largest block span requested in a single eth_getLogs call. */
    maxBlockRange: bigint;
    /** Upper bound on getLogs windows per token per cycle (keeps a catch-up bounded). */
    maxWindowsPerRun: number;
}

export const DEFAULT_MAX_BLOCK_RANGE = 2000n;
export const DEFAULT_MAX_WINDOWS_PER_RUN = 25;

function parseInteger(
    env: NodeJS.ProcessEnv,
    name: string,
    fallback: bigint,
    minimum: bigint,
): bigint {
    const raw = env[name]?.trim();

    if (!raw) {
        return fallback;
    }

    if (!/^\d+$/.test(raw) || BigInt(raw) < minimum) {
        throw new Error(`Invalid ${name} "${raw}": expected an integer >= ${minimum.toString()}`);
    }

    return BigInt(raw);
}

export function loadEvmIndexerConfig(env: NodeJS.ProcessEnv = process.env): EvmIndexerConfig {
    const maxWindowsPerRun = parseInteger(
        env,
        'EVM_INDEX_MAX_WINDOWS_PER_RUN',
        BigInt(DEFAULT_MAX_WINDOWS_PER_RUN),
        1n,
    );

    return {
        startBlock: parseInteger(env, 'EVM_INDEX_START_BLOCK', 0n, 0n),
        confirmations: parseInteger(env, 'EVM_INDEX_CONFIRMATIONS', 0n, 0n),
        maxBlockRange: parseInteger(env, 'EVM_LOGS_MAX_BLOCK_RANGE', DEFAULT_MAX_BLOCK_RANGE, 1n),
        maxWindowsPerRun: Number(maxWindowsPerRun),
    };
}

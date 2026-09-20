import { Connection } from '@solana/web3.js';

import { getSolanaConfig } from './config.js';

let cachedConnection: Connection | null = null;

// Lazy and memoized so importing this module (e.g. via
// blockchain-adapters.ts, loaded on every process start) never validates
// SOLANA_RPC_URL — only actually calling a Solana adapter method does.
// This matches BitcoinRpcClient.call(), which reads getBitcoinConfig()
// per-call rather than at construction time, for the same reason.
export function getSolanaConnection(): Connection {
    if (!cachedConnection) {
        cachedConnection = new Connection(getSolanaConfig().SOLANA_RPC_URL, 'confirmed');
    }

    return cachedConnection;
}

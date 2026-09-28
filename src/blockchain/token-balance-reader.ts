/**
 * Chain-neutral balance observation.
 *
 * Nothing here is EVM-specific. `blockNumber` is the chain's monotonic
 * position marker for an observation: an EVM block number, a Bitcoin block
 * height, or a Solana slot. The only property consumers rely on is that a
 * larger value means a later chain state, which is what lets
 * BalanceReconciliationService tell a stale observation from a real
 * mismatch without knowing which chain it is looking at.
 */
export interface TokenBalanceReader {
    getTokenBalance(request: TokenBalanceRequest): Promise<TokenBalance>;
}

export interface TokenBalanceRequest {
    /**
     * Chain-specific identifier of the asset to read (an EVM contract
     * address, a Solana mint, ...). Absent means the chain's native asset.
     * Adapters that can't serve the request must throw rather than guess.
     */
    assetIdentifier?: string;
    walletAddress: string;
    /**
     * Read at this position. Absent means "latest"; the adapter reports
     * the position it actually observed in `TokenBalance.blockNumber`.
     */
    blockNumber?: bigint;
}

export interface TokenBalance {
    /** Smallest indivisible unit (wei, satoshi, lamport, token base units). */
    balance: bigint;
    /** Chain position the balance was observed at. See the note above. */
    blockNumber: bigint;
}

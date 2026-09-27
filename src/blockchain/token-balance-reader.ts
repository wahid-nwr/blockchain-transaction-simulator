export interface TokenBalanceReader {
    getTokenBalance(request: TokenBalanceRequest): Promise<TokenBalance>;
}

export interface TokenBalanceRequest {
    tokenAddress: string;
    walletAddress: string;
    blockNumber?: bigint;
}

export interface TokenBalance {
    balance: bigint;
    blockNumber: bigint;
}

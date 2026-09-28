import { BitcoinRpcClient } from './rpc.client.js';
import type { TokenBalance, TokenBalanceRequest } from '../token-balance-reader.js';

import type {
    BlockchainAdapter,
    BlockchainTransaction,
    TransferRequest,
    TransferSubmission,
} from '../blockchain-adapter.js';

type BitcoinTransaction = {
    confirmations?: number;
    blockhash?: string;
};

type BitcoinBlockHeader = {
    height: number;
};

type BitcoinUnspentOutput = {
    amount: number;
};

type BitcoinBlockchainInfo = {
    blocks: number;
};

function btcToSatoshis(amount: number): bigint {
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('Bitcoin RPC returned an invalid BTC amount');
    }

    // Bitcoin Core exposes BTC amounts as JSON numbers. Formatting to the
    // protocol's fixed 8 decimal places before converting avoids carrying
    // binary floating-point residue into the ledger's integer representation.
    return BigInt(Math.round(Number(amount.toFixed(8)) * 100_000_000));
}

function satoshisToBtc(amount: bigint): number {
    if (amount < 0n) {
        throw new Error('Bitcoin transfer amount cannot be negative');
    }

    // Bitcoin's maximum monetary supply is safely below Number.MAX_SAFE_INTEGER
    // when represented in satoshis.
    if (amount > 21_000_000n * 100_000_000n) {
        throw new Error('Bitcoin transfer amount exceeds maximum supply');
    }

    return Number(amount) / 100_000_000;
}

export class BitcoinAdapter implements BlockchainAdapter {
    readonly chain = 'BITCOIN';

    constructor(private readonly rpc: BitcoinRpcClient) {}

    // Bitcoin has no token/contract layer in this system — every transfer
    // and balance reconciliation is for the native BTC asset. Native assets
    // are represented by a Token row with a null contractAddress. See ADR-012.
    validateAssetIdentifier(_identifier: string): boolean {
        return false;
    }

    async getTokenBalance(request: TokenBalanceRequest): Promise<TokenBalance> {
        if (request.assetIdentifier) {
            throw new Error('Bitcoin balance reads support the native BTC asset only');
        }

        const blockchainInfo = await this.rpc.call<BitcoinBlockchainInfo>('getblockchaininfo', []);
        const observedBlock = BigInt(blockchainInfo.blocks);

        if (request.blockNumber !== undefined && request.blockNumber > observedBlock) {
            throw new Error(
                `Requested Bitcoin observation at height ${request.blockNumber} is ahead of chain tip ${observedBlock}`,
            );
        }

        // Bitcoin Core's wallet-scoped UTXO view is the authoritative balance
        // for a custodial wallet address. It is current-state data, so the
        // returned observation position is the chain tip rather than a
        // historical height. Historical address balances would require
        // reconstructing the UTXO set from every block and are deliberately
        // outside this adapter's scope.
        const utxos = await this.rpc.call<BitcoinUnspentOutput[]>(
            'listunspent',
            [1, 9999999, [request.walletAddress]],
            true,
        );

        const balance = utxos.reduce((total, utxo) => total + btcToSatoshis(utxo.amount), 0n);

        return {
            balance,
            blockNumber: observedBlock,
        };
    }

    async submitTransfer(request: TransferRequest): Promise<TransferSubmission> {
        const txHash = await this.rpc.call<string>(
            'sendtoaddress',
            [request.toAddress, satoshisToBtc(request.amount)],
            true,
        );

        return { txHash };
    }

    async getTransaction(txHash: string): Promise<BlockchainTransaction> {
        const transaction = await this.rpc.call<BitcoinTransaction>('getrawtransaction', [
            txHash,
            true,
        ]);

        // getrawtransaction omits `confirmations`/`blockhash` entirely
        // for a transaction that's still only in the mempool — it does
        // NOT throw the way an unmined EVM transaction lookup does. So
        // confirmations of 0 here means "still propagating," not "this
        // transaction failed," and must be reported as 'pending' rather
        // than as a terminal outcome. (Bitcoin has no on-chain revert
        // concept once a transaction is actually confirmed — a genuine
        // 'failed' status isn't reachable from this method today. A
        // transaction that's dropped from the mempool without ever
        // confirming instead surfaces as an RPC "not found" error, which
        // the caller already treats as retryable — see
        // ConfirmationProcessor.handleConfirmationError.)
        const confirmations = transaction.confirmations ?? 0;

        // getrawtransaction's verbose result does NOT include a
        // blockheight field (that only exists on the wallet-scoped
        // gettransaction RPC, which this method deliberately doesn't
        // call — see the custody-model note in the class doc comment).
        // Once a transaction is confirmed, resolve its height from the
        // blockhash via getblockheader instead. Doing this only when
        // confirmed keeps the common "still pending" poll to a single
        // RPC call.
        const blockNumber =
            confirmations > 0 && transaction.blockhash
                ? BigInt(
                      (
                          await this.rpc.call<BitcoinBlockHeader>('getblockheader', [
                              transaction.blockhash,
                          ])
                      ).height,
                  )
                : null;

        return {
            txHash,
            blockNumber,
            confirmations,
            status: confirmations > 0 ? 'confirmed' : 'pending',
            gasUsed: null,
        };
    }
}

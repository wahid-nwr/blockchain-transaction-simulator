import type { CustodyType } from '@prisma/client';
import type { TokenBalance, TokenBalanceRequest } from './token-balance-reader.js';

/**
 * 'pending'   — found, but not yet in a state the adapter can call final.
 *               Callers should treat this the same as "not found yet":
 *               retry later, don't record a terminal outcome.
 * 'confirmed' — final and successful.
 * 'failed'    — final and unsuccessful (e.g. an EVM revert). Distinct from
 *               'pending' specifically so an adapter is never forced to
 *               choose between "not confirmed yet" and "confirmed but bad"
 *               when it only has one boolean to say it with — that
 *               conflation was a real bug for the Bitcoin adapter (an
 *               unconfirmed, still-good mempool transaction was reported
 *               the same way as a genuine failure). See ADR-010.
 */
export type ConfirmationStatus = 'pending' | 'confirmed' | 'failed';

export interface BlockchainTransaction {
    txHash: string;
    blockNumber: bigint | null;
    confirmations: number;
    status: ConfirmationStatus;
    gasUsed: bigint | null;
    /**
     * Optional, adapter-populated detail for chains with more than one
     * non-pending finality level (e.g. Solana's confirmed/finalized
     * distinction). Not read by ConfirmationProcessor's pending/
     * confirmed/failed branching — for observability/logging only.
     * See ADR-010.
     */
    confirmationLevel?: string;
}

export interface TransferRequest {
    tenantId: string;
    walletId: string;
    toAddress: string;
    amount: bigint;
    assetIdentifier?: string;
}

export interface TransferSubmission {
    txHash: string;
}

export interface MintRequest {
    assetIdentifier: string;
    toAddress: string;
    amount: bigint;
}

export interface MintResult {
    txHash: string;
}

/**
 * What an adapter needs to know about a wallet to decide whether the
 * platform can sign for it. `hasCustodyKey` is a boolean on purpose: the
 * caller learns that a key exists, never the key material itself.
 */
export interface WalletCustodyStatus {
    custodyType: CustodyType;
    hasCustodyKey: boolean;
}

/**
 * Fresh key material for a new custodial wallet. `secret` is a UTF-8 string
 * in exactly the format this chain's signer service parses back out of the
 * envelope (see encryptWalletKey): `0x`-prefixed hex for EVM, plain hex of
 * the 64-byte secret key for Solana. It must be encrypted immediately and
 * never logged or returned to a client.
 */
export interface CustodialWalletMaterial {
    address: string;
    secret: string;
}

export interface OwnershipVerificationRequest {
    address: string;
    /** The exact text the wallet was asked to sign. */
    message: string;
    /** Wallet signature over `message`, in the chain's native encoding. */
    signature: string;
}

export interface BlockchainAdapter {
    readonly chain: string;

    /**
     * Whether the platform can sign a transfer from this wallet right now.
     * Required on every adapter (unlike mint/getTokenBalance) because it is a
     * safety precondition: TransferService asks it BEFORE writing anything to
     * the ledger, so a wallet the platform cannot sign for is rejected up
     * front instead of leaving a PENDING row that is guaranteed to end up
     * FAILED. "Can sign" is chain-specific: EVM and Solana need a
     * CUSTODIAL wallet with an encrypted key; Bitcoin signs through the
     * node's own wallet (ADR-011), so no per-wallet key is involved.
     */
    canSign(wallet: WalletCustodyStatus): boolean;

    /**
     * Generates a new keypair for a platform-held wallet. Optional, like
     * `mint`: absent on chains whose custody is not per-wallet (Bitcoin
     * delegates to the node wallet), so callers check
     * `if (adapter.createCustodialWallet)` and report
     * UNSUPPORTED_CHAIN_CAPABILITY.
     */
    createCustodialWallet?(): Promise<CustodialWalletMaterial>;

    /**
     * Whether `signature` proves control of `address` by signing `message`.
     * Optional, like mint: only chains that implement it can register EXTERNAL
     * wallets under REQUIRE_WALLET_OWNERSHIP_PROOF. Must resolve `false` for
     * any malformed or non-matching signature rather than throwing, so callers
     * can treat "invalid" uniformly.
     */
    verifyOwnership?(request: OwnershipVerificationRequest): Promise<boolean>;

    submitTransfer(request: TransferRequest): Promise<TransferSubmission>;

    getTransaction(txHash: string): Promise<BlockchainTransaction>;

    /**
     * Whether `identifier` is a well-formed asset identifier on this chain
     * (an EVM contract address, today). Required on every adapter so
     * registration can reject a malformed or wrong-chain-shaped identifier
     * before it reaches storage — the same role `isValidWalletAddress`
     * already plays for wallet creation. Bitcoin and Solana adapters
     * return `false` unconditionally: neither chain has a token/contract
     * layer in this system yet. See ADR-012.
     */
    validateAssetIdentifier(identifier: string): boolean;

    /**
     * Present only on adapters for chains with an actual mint-capable
     * token layer. Deliberately optional rather than a throwing stub —
     * an absent method lets callers check `if (adapter.mint)` instead of
     * needing to know which chains throw and with what. See ADR-012.
     */
    mint?(request: MintRequest): Promise<MintResult>;

    /**
     * Reads a wallet's balance of an asset straight from the chain, at a
     * given position or at the latest one. Optional for the same reason
     * as `mint`: callers (balance reconciliation today) check
     * `if (adapter.getTokenBalance)` and report UNSUPPORTED_CHAIN_CAPABILITY
     * rather than needing to know which chains throw. The returned
     * `blockNumber` is the chain's monotonic observation position (block
     * height, slot, ...), never assumed to be an EVM block number.
     */
    getTokenBalance?(request: TokenBalanceRequest): Promise<TokenBalance>;
}

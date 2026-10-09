import { mnemonicToAccount } from 'viem/accounts';
import { ANVIL_CHAIN_ID } from '../chain-ids.js';

/**
 * Guards for scripts/deploy-mini-usdt-live.ts, kept here (pure, no I/O) so the
 * rules that stop a bad deployment are unit-tested.
 *
 * A contract deployment is irreversible and the deployer becomes the token's
 * owner, i.e. the only account that can mint or pause it. The mistakes worth
 * preventing are: deploying to a network other than the one you think, deploying
 * from a key everyone knows, and deploying with no gas, in that order of cost.
 */

export class DeploySafetyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DeploySafetyError';
    }
}

// The mnemonic behind Anvil's and Hardhat's default accounts. Public by design.
// Accounts are derived from it at run time rather than listing their private
// keys, so no key material (and nothing a secret scanner would flag) lives in
// the repo.
const DEV_MNEMONIC = 'test test test test test test test test test test test junk';

// Anvil funds 10 of these, Hardhat 20.
const DEV_ACCOUNT_COUNT = 20;

let devAddresses: ReadonlySet<string> | undefined;

function wellKnownDevAddresses(): ReadonlySet<string> {
    devAddresses ??= new Set(
        Array.from({ length: DEV_ACCOUNT_COUNT }, (_, addressIndex) =>
            mnemonicToAccount(DEV_MNEMONIC, { addressIndex }).address.toLowerCase(),
        ),
    );

    return devAddresses;
}

/** True for an account whose private key is public (Anvil/Hardhat defaults). */
export function isWellKnownDevAccount(address: string): boolean {
    return wellKnownDevAddresses().has(address.toLowerCase());
}

/**
 * Normalises a private key from the environment. Errors never echo the value:
 * a malformed key is still very likely a real one.
 */
export function parseDeployerKey(raw: string | undefined): `0x${string}` {
    const trimmed = raw?.trim();

    if (!trimmed) {
        throw new DeploySafetyError('PRIVATE_KEY is not set');
    }

    const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;

    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
        throw new DeploySafetyError('PRIVATE_KEY is not a 32-byte hex private key');
    }

    return withPrefix as `0x${string}`;
}

/**
 * RPC URLs routinely carry the API key in the path or query
 * (`https://host/v2/<key>`), so anything printed or logged gets origin only.
 */
export function redactRpcUrl(url: string): string {
    try {
        return new URL(url).origin;
    } catch {
        return '<invalid RPC_URL>';
    }
}

/**
 * Replaces every URL inside free text with its origin. Provider errors embed
 * the full request URL, and with it the API key.
 */
export function redactUrlsInText(text: string): string {
    return text.replace(/https?:\/\/[^\s"'<>)]+/g, (match) => {
        // Sentence punctuation after a URL is not part of it.
        const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? '';
        const url = trailing ? match.slice(0, -trailing.length) : match;

        return `${redactRpcUrl(url)}${trailing}`;
    });
}

/**
 * A short, log-safe reason for a failed RPC call. Uses viem's `shortMessage` and
 * `details` rather than `message`, which also carries the request URL and the
 * whole request body (for a deployment: the full contract bytecode).
 */
export function describeRpcError(error: unknown): string {
    const e = error as { shortMessage?: unknown; details?: unknown; message?: unknown };

    const parts = [e?.shortMessage, e?.details]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .map((part) => part.split('\n')[0]!);

    const text =
        parts.length > 0
            ? parts.join(': ')
            : typeof e?.message === 'string'
              ? (e.message.split('\n')[0] ?? '')
              : String(error);

    return redactUrlsInText(text).slice(0, 300);
}

export interface DeployCheckInput {
    /** What this deployment is configured for (EVM_CHAIN_ID). */
    configuredChainId: number;
    /** What the RPC node actually reports (eth_chainId). */
    rpcChainId: number;
    deployerAddress: string;
    balance: bigint;
    estimatedCost: bigint;
}

/** Only the local development chain skips the live-network safeguards. */
export function isLocalChain(chainId: number): boolean {
    return chainId === ANVIL_CHAIN_ID;
}

/**
 * Throws DeploySafetyError if deploying now would be a mistake. Order matters:
 * the wrong-network check comes first because every later check is meaningless
 * against the wrong chain.
 */
export function assertDeployAllowed(input: DeployCheckInput): void {
    if (input.rpcChainId !== input.configuredChainId) {
        throw new DeploySafetyError(
            `RPC_URL serves chain ${input.rpcChainId} but EVM_CHAIN_ID is ${input.configuredChainId}. ` +
                'Refusing to deploy to a network you did not configure. Set EVM_CHAIN_ID to the ' +
                'chain you mean to deploy to, and check RPC_URL points at it.',
        );
    }

    if (!isLocalChain(input.configuredChainId) && isWellKnownDevAccount(input.deployerAddress)) {
        throw new DeploySafetyError(
            `${input.deployerAddress} is a well-known development account (Anvil/Hardhat default). ` +
                'Its private key is public, so anyone could mint or pause a token it owns. Generate a ' +
                'fresh key for this network.',
        );
    }

    if (input.balance === 0n) {
        throw new DeploySafetyError(
            `${input.deployerAddress} has no funds on chain ${input.configuredChainId}. ` +
                'Send it enough native token to pay for deployment gas, then re-run.',
        );
    }

    if (input.balance < input.estimatedCost) {
        throw new DeploySafetyError(
            `${input.deployerAddress} holds ${input.balance} wei but deployment is estimated to cost ` +
                `about ${input.estimatedCost} wei. Add funds and re-run.`,
        );
    }
}

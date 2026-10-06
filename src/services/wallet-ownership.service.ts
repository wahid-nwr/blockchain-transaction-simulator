import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../common/errors/app.error.js';
import { Errors } from '../common/errors/errors.js';
import type { BlockchainAdapterRegistry } from '../blockchain/blockchain-adapter.registry.js';
import {
    blockchainForChainId,
    isValidWalletAddress,
    normalizeWalletAddress,
} from '../blockchain/wallet-address.js';

/**
 * Proof that a user controls an address they want to register as an EXTERNAL
 * wallet.
 *
 * Without it `Wallet.address` is first-come-first-served: it is unique, and
 * nothing stops one user registering an address that belongs to someone else,
 * locking the real owner out and attaching that address's activity to the
 * wrong account.
 *
 * Challenge / response, stateless (no table, no migration):
 *   1. POST /wallets/challenge {chainId, address} returns a human-readable
 *      `message` and an opaque `challenge` token.
 *   2. The user signs `message` with the wallet (personal_sign).
 *   3. POST /wallets sends {chainId, address, challenge, signature}.
 *
 * The token is an HMAC-signed claim set binding tenant, user, chain, address,
 * a random nonce and an expiry. The server rebuilds `message` from the claims,
 * so the client cannot choose what is signed, and a token cannot be replayed
 * for another user, address or chain. It is a different format from the
 * access JWT and is MACed under a key derived with a domain-separation label,
 * so it can never be mistaken for one. Replaying the same proof after a
 * successful registration is harmless: the address is then already taken.
 */

const CHALLENGE_VERSION = 1;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Real tokens are a few hundred bytes; refuse anything bigger before parsing.
const MAX_CHALLENGE_LENGTH = 2048;
const KEY_LABEL = 'wallet-ownership-challenge:v1';

interface ChallengeClaims {
    v: number;
    tid: string;
    uid: string;
    cid: number;
    addr: string;
    nonce: string;
    iat: number;
    exp: number;
}

export interface OwnershipSubject {
    tenantId: string;
    userId: string;
    chainId: number;
    address: string;
}

export interface IssuedChallenge {
    message: string;
    challenge: string;
    expiresAt: string;
}

/**
 * `REQUIRE_WALLET_OWNERSHIP_PROOF`: when true, registering an EXTERNAL wallet
 * without a valid proof is rejected. Off by default so local development and
 * the e2e fixtures (which register arbitrary addresses) keep working; turn it
 * on for any public deployment.
 *
 * Parsed strictly: this is a security switch, so a typo must fail loudly
 * instead of silently meaning "off".
 */
export function isOwnershipProofRequired(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = env.REQUIRE_WALLET_OWNERSHIP_PROOF?.trim().toLowerCase();

    if (raw === undefined || raw === '' || raw === 'false' || raw === '0') {
        return false;
    }

    if (raw === 'true' || raw === '1') {
        return true;
    }

    throw new Error(
        `Invalid REQUIRE_WALLET_OWNERSHIP_PROOF "${env.REQUIRE_WALLET_OWNERSHIP_PROOF}": expected true or false`,
    );
}

export function buildOwnershipMessage(claims: ChallengeClaims): string {
    return [
        'Link this wallet to the Blockchain Transaction Simulator.',
        '',
        `Address: ${claims.addr}`,
        `Chain ID: ${claims.cid}`,
        `Nonce: ${claims.nonce}`,
        `Issued At: ${new Date(claims.iat).toISOString()}`,
        `Expires At: ${new Date(claims.exp).toISOString()}`,
        '',
        'Signing only proves you control this address. It sends no transaction and costs no gas.',
    ].join('\n');
}

export class WalletOwnershipService {
    constructor(
        private readonly registry: BlockchainAdapterRegistry,
        private readonly secret: () => string = () => env.JWT_SECRET,
        private readonly now: () => number = () => Date.now(),
    ) {}

    issueChallenge(subject: OwnershipSubject): IssuedChallenge {
        const blockchain = blockchainForChainId(subject.chainId);

        if (!blockchain) {
            throw Errors.unsupportedChain(subject.chainId);
        }

        if (!this.registry.get(blockchain).verifyOwnership) {
            throw Errors.unsupportedChainCapability('ownership verification', blockchain);
        }

        if (!isValidWalletAddress(subject.chainId, subject.address)) {
            throw new AppError(400, 'INVALID_WALLET_ADDRESS', 'Invalid wallet address');
        }

        const issuedAt = this.now();

        const claims: ChallengeClaims = {
            v: CHALLENGE_VERSION,
            tid: subject.tenantId,
            uid: subject.userId,
            cid: subject.chainId,
            addr: normalizeWalletAddress(subject.chainId, subject.address),
            nonce: randomBytes(16).toString('hex'),
            iat: issuedAt,
            exp: issuedAt + CHALLENGE_TTL_MS,
        };

        return {
            message: buildOwnershipMessage(claims),
            challenge: this.seal(claims),
            expiresAt: new Date(claims.exp).toISOString(),
        };
    }

    /**
     * Gate for registering an EXTERNAL wallet. Resolves when registration may
     * proceed (proof valid, or none needed) and throws an AppError otherwise.
     * Runs BEFORE the "address already registered" check, so someone who
     * cannot prove an address learns nothing about whether it is taken.
     */
    async assertOwnership(params: OwnershipSubject & { challenge?: string; signature?: string }) {
        const blockchain = blockchainForChainId(params.chainId);

        // Unknown chain: nothing to prove against; registration itself rejects it.
        if (!blockchain) {
            return;
        }

        const required = isOwnershipProofRequired();
        const proofGiven = params.challenge !== undefined && params.signature !== undefined;

        if (!required && !proofGiven) {
            return;
        }

        // Fail closed: if proof is required (or was offered) for a chain that
        // cannot verify it, refuse rather than quietly skip the check.
        const adapter = this.registry.get(blockchain);

        if (!adapter.verifyOwnership) {
            throw Errors.unsupportedChainCapability('ownership verification', blockchain);
        }

        if (!proofGiven) {
            throw Errors.ownershipProofRequired();
        }

        const claims = this.open(params.challenge as string);

        const matchesRequest =
            claims.tid === params.tenantId &&
            claims.uid === params.userId &&
            claims.cid === params.chainId &&
            claims.addr === normalizeWalletAddress(params.chainId, params.address);

        if (!matchesRequest) {
            throw Errors.invalidOwnershipChallenge();
        }

        const proven = await adapter.verifyOwnership({
            address: claims.addr,
            message: buildOwnershipMessage(claims),
            signature: params.signature as string,
        });

        if (!proven) {
            throw Errors.invalidOwnershipSignature();
        }
    }

    private key(): Buffer {
        return createHmac('sha256', this.secret()).update(KEY_LABEL).digest();
    }

    private mac(payload: string): Buffer {
        return createHmac('sha256', this.key()).update(payload).digest();
    }

    private seal(claims: ChallengeClaims): string {
        const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');

        return `${payload}.${this.mac(payload).toString('base64url')}`;
    }

    private open(token: string): ChallengeClaims {
        if (token.length > MAX_CHALLENGE_LENGTH) {
            throw Errors.invalidOwnershipChallenge();
        }

        const parts = token.split('.');

        if (parts.length !== 2) {
            throw Errors.invalidOwnershipChallenge();
        }

        const [payload, presentedMac] = parts as [string, string];
        const expected = this.mac(payload);
        const presented = Buffer.from(presentedMac, 'base64url');

        if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
            throw Errors.invalidOwnershipChallenge();
        }

        let claims: ChallengeClaims;

        try {
            claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        } catch {
            throw Errors.invalidOwnershipChallenge();
        }

        const wellFormed =
            claims.v === CHALLENGE_VERSION &&
            typeof claims.tid === 'string' &&
            typeof claims.uid === 'string' &&
            Number.isInteger(claims.cid) &&
            typeof claims.addr === 'string' &&
            typeof claims.nonce === 'string' &&
            Number.isFinite(claims.iat) &&
            Number.isFinite(claims.exp);

        if (!wellFormed || claims.exp <= this.now()) {
            throw Errors.invalidOwnershipChallenge();
        }

        return claims;
    }
}

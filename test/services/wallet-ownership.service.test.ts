import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import {
    WalletOwnershipService,
    buildOwnershipMessage,
    isOwnershipProofRequired,
} from '../../src/services/wallet-ownership.service.js';
import { BlockchainAdapterRegistry } from '../../src/blockchain/blockchain-adapter.registry.js';
import { EvmAdapter } from '../../src/blockchain/evm/evm.adapter.js';
import { BitcoinAdapter } from '../../src/blockchain/bitcoin/bitcoin.adapter.js';
import { ANVIL_CHAIN_ID, BITCOIN_REGTEST_CHAIN_ID } from '../../src/blockchain/wallet-address.js';

const SECRET = 'unit-test-secret';
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);

describe('WalletOwnershipService', () => {
    let now: number;
    let service: WalletOwnershipService;

    const account = privateKeyToAccount(generatePrivateKey());
    const lowerAddress = account.address.toLowerCase();

    const subject = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        chainId: ANVIL_CHAIN_ID,
        address: account.address,
    };

    function makeService(secret = SECRET) {
        return new WalletOwnershipService(
            new BlockchainAdapterRegistry([
                new EvmAdapter(
                    { getWalletClientFor: vi.fn() } as never,
                    { mint: vi.fn() } as never,
                ),
                new BitcoinAdapter({ call: vi.fn() } as never),
            ]),
            () => secret,
            () => now,
        );
    }

    // Full happy path helper: issue a challenge and sign its message.
    async function signedProof(signer = account, overrides: Partial<typeof subject> = {}) {
        const issued = makeService().issueChallenge({ ...subject, ...overrides });

        return {
            challenge: issued.challenge,
            signature: await signer.signMessage({ message: issued.message }),
            message: issued.message,
        };
    }

    beforeEach(() => {
        now = T0;
        service = makeService();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('issueChallenge', () => {
        it('returns a message naming the address, chain and expiry, plus an opaque token', () => {
            const issued = service.issueChallenge(subject);

            expect(issued.message).toContain(`Address: ${lowerAddress}`);
            expect(issued.message).toContain(`Chain ID: ${ANVIL_CHAIN_ID}`);
            expect(issued.message).toContain('costs no gas');
            expect(issued.expiresAt).toBe(new Date(T0 + 5 * 60 * 1000).toISOString());
            expect(issued.challenge).toMatch(/^[\w-]+\.[\w-]+$/);
        });

        it('issues a different nonce every time', () => {
            expect(service.issueChallenge(subject).challenge).not.toBe(
                service.issueChallenge(subject).challenge,
            );
        });

        it('rejects an address that is not valid for the chain', () => {
            expect(() => service.issueChallenge({ ...subject, address: 'nope' })).toThrow(
                expect.objectContaining({ code: 'INVALID_WALLET_ADDRESS' }),
            );
        });

        it('rejects an unknown chain', () => {
            expect(() => service.issueChallenge({ ...subject, chainId: 1 })).toThrow(
                expect.objectContaining({ code: 'UNSUPPORTED_CHAIN' }),
            );
        });

        it('rejects a chain whose adapter cannot verify ownership (Bitcoin)', () => {
            expect(() =>
                service.issueChallenge({ ...subject, chainId: BITCOIN_REGTEST_CHAIN_ID }),
            ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CHAIN_CAPABILITY' }));
        });
    });

    describe('assertOwnership with a valid proof', () => {
        it('accepts a signature from the address owner', async () => {
            const proof = await signedProof();

            await expect(
                service.assertOwnership({ ...subject, ...proof }),
            ).resolves.toBeUndefined();
        });

        it('treats the address case-insensitively (checksummed vs lowercase)', async () => {
            const proof = await signedProof();

            await expect(
                service.assertOwnership({ ...subject, address: lowerAddress, ...proof }),
            ).resolves.toBeUndefined();
        });
    });

    describe('assertOwnership rejects', () => {
        it('a signature from someone who does not own the address (the squatting case)', async () => {
            const attacker = privateKeyToAccount(generatePrivateKey());
            // The attacker asks for a challenge on the victim's address, then
            // signs it with their own key.
            const proof = await signedProof(attacker);

            await expect(service.assertOwnership({ ...subject, ...proof })).rejects.toMatchObject({
                code: 'INVALID_OWNERSHIP_SIGNATURE',
                statusCode: 403,
            });
        });

        it('an expired challenge', async () => {
            const proof = await signedProof();
            now = T0 + 5 * 60 * 1000 + 1;

            await expect(service.assertOwnership({ ...subject, ...proof })).rejects.toMatchObject({
                code: 'INVALID_OWNERSHIP_CHALLENGE',
            });
        });

        it('a tampered token', async () => {
            const proof = await signedProof();
            const [payload, mac] = proof.challenge.split('.');
            const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
            claims.uid = 'someone-else';
            const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`;

            await expect(
                service.assertOwnership({ ...subject, ...proof, challenge: forged }),
            ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_CHALLENGE' });
        });

        it('a token sealed under a different secret', async () => {
            const foreign = makeService('another-secret').issueChallenge(subject);
            const signature = await account.signMessage({ message: foreign.message });

            await expect(
                service.assertOwnership({ ...subject, challenge: foreign.challenge, signature }),
            ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_CHALLENGE' });
        });

        it.each([
            ['another user', { userId: 'user-2' }],
            ['another tenant', { tenantId: 'tenant-2' }],
        ])('a challenge issued for %s', async (_label, other) => {
            const proof = await signedProof();

            await expect(
                service.assertOwnership({ ...subject, ...other, ...proof }),
            ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_CHALLENGE' });
        });

        it('a challenge issued for a different address', async () => {
            const other = privateKeyToAccount(generatePrivateKey());
            const proof = await signedProof(account);

            await expect(
                service.assertOwnership({ ...subject, address: other.address, ...proof }),
            ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_CHALLENGE' });
        });

        it.each([
            ['empty', ''],
            ['no separator', 'abc'],
            ['three parts', 'a.b.c'],
            ['oversized', 'x'.repeat(4000)],
            ['garbage parts', 'not-json.not-a-mac'],
        ])('a malformed token (%s)', async (_label, challenge) => {
            await expect(
                service.assertOwnership({ ...subject, challenge, signature: '0x00' }),
            ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_CHALLENGE' });
        });

        it.each(['0x1234', 'not-hex', `0x${'00'.repeat(65)}`])(
            'a malformed signature (%s) as a clean 403, never a 500',
            async (signature) => {
                const proof = await signedProof();

                await expect(
                    service.assertOwnership({ ...subject, challenge: proof.challenge, signature }),
                ).rejects.toMatchObject({ code: 'INVALID_OWNERSHIP_SIGNATURE', statusCode: 403 });
            },
        );
    });

    describe('when proof is not required', () => {
        it('lets registration through with no proof', async () => {
            await expect(service.assertOwnership(subject)).resolves.toBeUndefined();
        });

        it('still rejects a proof that is offered but wrong', async () => {
            const attacker = privateKeyToAccount(generatePrivateKey());
            const proof = await signedProof(attacker);

            await expect(service.assertOwnership({ ...subject, ...proof })).rejects.toMatchObject({
                code: 'INVALID_OWNERSHIP_SIGNATURE',
            });
        });

        it('ignores chains it does not know, leaving rejection to registration', async () => {
            await expect(
                service.assertOwnership({ ...subject, chainId: 1 }),
            ).resolves.toBeUndefined();
        });
    });

    describe('when proof is required (REQUIRE_WALLET_OWNERSHIP_PROOF=true)', () => {
        beforeEach(() => {
            vi.stubEnv('REQUIRE_WALLET_OWNERSHIP_PROOF', 'true');
        });

        it('rejects registration without a proof', async () => {
            await expect(service.assertOwnership(subject)).rejects.toMatchObject({
                code: 'OWNERSHIP_PROOF_REQUIRED',
                statusCode: 400,
            });
        });

        it('rejects a lone challenge or lone signature', async () => {
            const proof = await signedProof();

            await expect(
                service.assertOwnership({ ...subject, challenge: proof.challenge }),
            ).rejects.toMatchObject({ code: 'OWNERSHIP_PROOF_REQUIRED' });
            await expect(
                service.assertOwnership({ ...subject, signature: proof.signature }),
            ).rejects.toMatchObject({ code: 'OWNERSHIP_PROOF_REQUIRED' });
        });

        it('accepts a valid proof', async () => {
            const proof = await signedProof();

            await expect(
                service.assertOwnership({ ...subject, ...proof }),
            ).resolves.toBeUndefined();
        });

        it('fails closed for a chain that cannot verify ownership', async () => {
            await expect(
                service.assertOwnership({
                    ...subject,
                    chainId: BITCOIN_REGTEST_CHAIN_ID,
                    address: 'bcrt1qanything',
                }),
            ).rejects.toMatchObject({ code: 'UNSUPPORTED_CHAIN_CAPABILITY' });
        });
    });
});

describe('buildOwnershipMessage', () => {
    it('is deterministic for a given claim set', () => {
        const claims = {
            v: 1,
            tid: 't',
            uid: 'u',
            cid: 31337,
            addr: '0xabc',
            nonce: 'n',
            iat: T0,
            exp: T0 + 1000,
        };

        expect(buildOwnershipMessage(claims)).toBe(buildOwnershipMessage({ ...claims }));
    });
});

describe('isOwnershipProofRequired', () => {
    it.each([
        [{}, false],
        [{ REQUIRE_WALLET_OWNERSHIP_PROOF: '' }, false],
        [{ REQUIRE_WALLET_OWNERSHIP_PROOF: 'false' }, false],
        [{ REQUIRE_WALLET_OWNERSHIP_PROOF: '0' }, false],
        [{ REQUIRE_WALLET_OWNERSHIP_PROOF: 'true' }, true],
        [{ REQUIRE_WALLET_OWNERSHIP_PROOF: ' TRUE ' }, true],
        [{ REQUIRE_WALLET_OWNERSHIP_PROOF: '1' }, true],
    ])('parses %j as %s', (env, expected) => {
        expect(isOwnershipProofRequired(env)).toBe(expected);
    });

    it.each(['yes', 'ture', 'on', 'enabled'])(
        'throws on the ambiguous value "%s" instead of silently meaning off',
        (value) => {
            expect(() =>
                isOwnershipProofRequired({ REQUIRE_WALLET_OWNERSHIP_PROOF: value }),
            ).toThrow(/Invalid REQUIRE_WALLET_OWNERSHIP_PROOF/);
        },
    );
});

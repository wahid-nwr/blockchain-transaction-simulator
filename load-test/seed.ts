/**
 * Seeds a tenant, user, token, and two custodial wallets for load testing,
 * then prints ready-to-export env vars for load-test/transfer-flow.js.
 *
 * Deliberately reuses the same test/factories/* used by the integration
 * suite rather than hand-rolling separate seed logic — the point of a load
 * test is to exercise the real system, and "real system" should mean the
 * same fixture shape the correctness tests already trust. If a factory
 * changes, both suites drift together instead of silently diverging.
 *
 * This runs in Node (via tsx), NOT inside k6 — k6 scripts execute in k6's
 * own JS runtime (goja) and cannot import Prisma, TypeScript, or any
 * app/test module directly. This script is the seam between "set up data
 * with real app code" and "load-test against HTTP like a real client."
 *
 * Usage:
 *   npx tsx load-test/seed.ts
 *   npx tsx load-test/seed.ts --json > load-test/.env.load-test.json
 */

import { createTenant } from '../test/factories/tenant.factory.js';
import { createUser } from '../test/factories/user.factory.js';
import { createToken } from '../test/factories/token.factory.js';
import { createCustodialWallet } from '../test/factories/wallet.factory.js';
import { hashPassword } from '../src/auth/password.service.js';
import { prisma } from '../src/database/prisma.js';

const LOAD_TEST_PASSWORD = 'load-test-password-123';

async function main() {
    const { tenant } = await createTenant({ name: `load-test-${Date.now()}` });

    const passwordHash = await hashPassword(LOAD_TEST_PASSWORD);
    const user = await createUser({
        tenant: { id: tenant.id },
        email: `load-test-${Date.now()}@example.com`,
        passwordHash,
    });

    const token = await createToken();

    // Two funded custodial wallets so the transfer flow has a real
    // from/to pair without needing an EXTERNAL wallet + separate signer.
    const fromWallet = await createCustodialWallet({ tenantId: tenant.id, ownerId: user.id });
    const toWallet = await createCustodialWallet({ tenantId: tenant.id, ownerId: user.id });

    const env = {
        LOAD_TEST_EMAIL: user.email,
        LOAD_TEST_PASSWORD,
        LOAD_TEST_TOKEN_ID: token.id,
        LOAD_TEST_FROM_WALLET_ID: fromWallet.id,
        LOAD_TEST_TO_WALLET_ID: toWallet.id,
    };

    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(env, null, 2));
    } else {
        console.log('# Seeded load-test fixtures. Copy/paste to export:\n');
        for (const [key, value] of Object.entries(env)) {
            console.log(`-e ${key}=${value} \\`);
        }
    }
}

main()
    .catch((err) => {
        console.error('Seed failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

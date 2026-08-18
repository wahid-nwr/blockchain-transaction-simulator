/**
 * Load test for the hot path: authenticate -> create transfer -> poll status.
 *
 * This exercises the same path documented in docs/decisions/005 and is the
 * thing docs/capacity-planning.md (roadmap Phase 3) should report numbers
 * against: submission throughput, confirmation-worker lag under load, and
 * where the first bottleneck appears (API, DB pool, or RPC provider).
 *
 * Usage:
 *   k6 run load-test/transfer-flow.js
 *   k6 run --vus 50 --duration 2m load-test/transfer-flow.js
 *
 * Requires a running stack (docker-compose.yml) and a seeded tenant/user/
 * token/wallet pair referenced via env vars below — see load-test/README.md.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const EMAIL = __ENV.LOAD_TEST_EMAIL;
const PASSWORD = __ENV.LOAD_TEST_PASSWORD;
const TOKEN_ID = __ENV.LOAD_TEST_TOKEN_ID;
const FROM_WALLET_ID = __ENV.LOAD_TEST_FROM_WALLET_ID;
const TO_WALLET_ID = __ENV.LOAD_TEST_TO_WALLET_ID;

const submissionLatency = new Trend('transfer_submission_latency_ms', true);
const confirmationLatency = new Trend('transfer_confirmation_latency_ms', true);
const confirmedRate = new Rate('transfer_confirmed_rate');

export const options = {
    scenarios: {
        steady_state: {
            executor: 'constant-vus',
            vus: Number(__ENV.VUS) || 10,
            duration: __ENV.DURATION || '1m',
        },
    },
    thresholds: {
        // These are starting guesses, not measured SLOs. Replace with real
        // numbers once docs/capacity-planning.md has a baseline run — an
        // unjustified threshold is worse than no threshold.
        transfer_submission_latency_ms: ['p(95)<500'],
        transfer_confirmed_rate: ['rate>0.99'],
        http_req_failed: ['rate<0.01'],
    },
};

function authenticate() {
    const res = http.post(
        `${BASE_URL}/auth/login`,
        JSON.stringify({ email: EMAIL, password: PASSWORD }),
        { headers: { 'Content-Type': 'application/json' } },
    );
    if (res.status !== 200) {
        // Temporary diagnostic logging for the VUs>1 failure investigation.
        // Remove once resolved.
        console.log(`login failed: status=${res.status} body=${res.body}`);
    }
    check(res, { 'login succeeded': (r) => r.status === 200 });
    return res.json('data.accessToken');
}

export default function () {
    const token = authenticate();
    const authHeaders = {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
    };

    const submitStart = Date.now();
    const createRes = http.post(
        `${BASE_URL}/transactions`,
        JSON.stringify({
            tokenId: TOKEN_ID,
            fromWalletId: FROM_WALLET_ID,
            toWalletId: TO_WALLET_ID,
            amount: '1',
        }),
        authHeaders,
    );
    submissionLatency.add(Date.now() - submitStart);

    const created = check(createRes, {
        'transfer accepted (201)': (r) => r.status === 201,
    });
    if (!created) {
        confirmedRate.add(false);
        sleep(1);
        return;
    }

    const transactionId = createRes.json('data.id');

    // Poll for terminal state. This intentionally mirrors client behavior,
    // not internal worker timing, since the point is to measure what a
    // caller actually experiences.
    const pollStart = Date.now();
    let status;
    for (let attempt = 0; attempt < 30; attempt++) {
        sleep(1);
        const pollRes = http.get(`${BASE_URL}/transactions/${transactionId}`, authHeaders);
        status = pollRes.json('data.status');
        if (status === 'CONFIRMED' || status === 'FAILED' || status === 'EXPIRED') {
            break;
        }
    }

    confirmationLatency.add(Date.now() - pollStart);
    confirmedRate.add(status === 'CONFIRMED');
}

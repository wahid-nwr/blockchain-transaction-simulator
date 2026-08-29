import { describe, it, expect, beforeEach } from 'vitest';

import { executeRpc } from '../../src/blockchain/rpc.executor.js';
import { registry } from '../../src/observability/metrics.js';

/*
 * executeRpc() is the only caller of recordRpcFailure() — the
 * reason-labeled counter (blockchain_rpc_failures_total) that
 * instrumentRpc() previously (and incorrectly) tried to increment itself.
 * This suite covers that path directly, against the real registry scrape
 * text, to close the coverage gap that let the label mismatch ship
 * unnoticed. See rpc.metrics.test.ts for the corresponding
 * blockchain_rpc_requests_total coverage.
 */
describe('executeRpc', () => {
    beforeEach(() => {
        registry.resetMetrics();
    });

    it('records a reason-labeled failure for a non-retryable error', async () => {
        await expect(
            executeRpc('eth_call', async () => {
                throw new Error('execution reverted: insufficient balance');
            }),
        ).rejects.toThrow();

        const metrics = await registry.metrics();

        expect(metrics).toContain(
            'blockchain_rpc_failures_total{method="eth_call",reason="reverted"} 1',
        );
    });

    it('records a reason-labeled failure after retries are exhausted', async () => {
        await expect(
            executeRpc('eth_getBalance', async () => {
                throw new Error('ECONNREFUSED');
            }),
        ).rejects.toThrow();

        const metrics = await registry.metrics();

        expect(metrics).toContain(
            'blockchain_rpc_failures_total{method="eth_getBalance",reason="network"} 1',
        );

        // A retryable classification means the retry loop actually ran —
        // confirms this isn't accidentally hitting the non-retryable
        // short-circuit path.
        expect(metrics).toContain('blockchain_rpc_retries_total{method="eth_getBalance"}');
    }, 15_000);

    it('resolves normally on success, recording no failure', async () => {
        const result = await executeRpc('eth_blockNumber', async () => '0x1');

        expect(result).toBe('0x1');

        const metrics = await registry.metrics();

        expect(metrics).not.toContain('blockchain_rpc_failures_total{method="eth_blockNumber"');
    });
});

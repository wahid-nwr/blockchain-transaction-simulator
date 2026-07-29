import { describe, it, expect } from 'vitest';
import { instrumentRpc } from '../../src/blockchain/rpc.instrumentation.js';
import { registry } from '../../src/observability/metrics.js';

describe('RPC instrumentation', () => {
    it('records successful RPC calls', async () => {
        await instrumentRpc('getTransactionReceipt', async () => ({
            status: 'success',
        }));

        const metrics = await registry.metrics();

        expect(metrics).toContain('blockchain_rpc_requests_total');
    });
});

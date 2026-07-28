import { describe, it, expect, vi, beforeEach } from 'vitest';

import { instrumentRpc } from '../../src/blockchain/rpc.instrumentation.js';

import { rpcSuccess, rpcFailures, rpcDuration } from '../../src/observability/rpc.metrics.js';

describe('instrumentRpc', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should record successful RPC request', async () => {
        const successSpy = vi.spyOn(rpcSuccess, 'inc');

        const durationSpy = vi.spyOn(rpcDuration, 'observe');

        const result = await instrumentRpc('eth_getBalance', async () => '0x123');

        expect(result).toBe('0x123');

        expect(successSpy).toHaveBeenCalledWith({
            method: 'eth_getBalance',
            status: 'success',
        });

        expect(durationSpy).toHaveBeenCalled();
    });

    it('should record failed RPC request', async () => {
        const failureSpy = vi.spyOn(rpcFailures, 'inc');

        const durationSpy = vi.spyOn(rpcDuration, 'observe');

        await expect(
            instrumentRpc('eth_sendRawTransaction', async () => {
                throw new Error('RPC failed');
            }),
        ).rejects.toThrow('RPC failed');

        expect(failureSpy).toHaveBeenCalledWith({
            method: 'eth_sendRawTransaction',
            status: 'error',
        });

        expect(durationSpy).toHaveBeenCalled();
    });

    it('should return wrapped RPC result', async () => {
        const result = await instrumentRpc('test_method', async () => ({
            value: 42,
        }));

        expect(result).toEqual({
            value: 42,
        });
    });
});

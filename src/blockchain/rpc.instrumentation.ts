import { rpcSuccess, rpcFailures, rpcDuration } from '../observability/rpc.metrics.js';

export async function instrumentRpc<T>(method: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();

    try {
        const result = await fn();

        rpcSuccess.inc({
            method,
            status: 'success',
        });

        return result;
    } catch (error) {
        rpcFailures.inc({
            method,
            status: 'error',
        });

        throw error;
    } finally {
        rpcDuration.observe(
            {
                method,
            },
            (performance.now() - start) / 1000,
        );
    }
}

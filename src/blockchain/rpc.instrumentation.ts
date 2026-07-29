import { rpcSuccess, rpcFailures, rpcDuration } from '../observability/rpc.metrics.js';

console.log("RPC metrics called success!");
export async function instrumentRpc<T>(method: string, fn: () => Promise<T>): Promise<T> {
    console.log("RPC metrics starting");
    const start = performance.now();

    try {
        console.log("RPC metrics increased");
        const result = await fn();

        rpcSuccess.inc({
            method,
            status: 'success',
        });

        return result;
    } catch (error) {
        console.log("RPC metrics error");
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

import {
    rpcRequestsTotal as rpcSuccess,
    rpcFailuresTotal as rpcFailures,
    rpcDurationSeconds as rpcDuration,
} from '../observability/rpc.metrics.js';

import { incrementMetric, observeMetric } from '../observability/metrics.js';

export async function instrumentRpc<T>(method: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();

    try {
        const result = await fn();

        incrementMetric(rpcSuccess, {
            method,
            status: 'success',
        });

        return result;
    } catch (error) {
        incrementMetric(rpcFailures, {
            method,
            status: 'error',
        });

        throw error;
    } finally {
        observeMetric(rpcDuration, (performance.now() - start) / 1000, {
            method,
        });
    }
}

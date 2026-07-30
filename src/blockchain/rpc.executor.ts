import { retry } from '../utils/retry.js';

import { recordRpcFailure, recordRpcRetry } from '../observability/rpc.metrics.js';

import { classifyRpcError } from './rpc.classifier.js';
import { RpcError, RpcTimeoutError } from './rpc.errors.js';
import { instrumentRpc } from './rpc.instrumentation.js';
import { getLogger } from '../observability/logger.js';

const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS ?? 10_000);
const RPC_MAX_RETRIES = Number(process.env.RPC_MAX_RETRIES ?? 3);
const RPC_RETRY_DELAY_MS = Number(process.env.RPC_RETRY_DELAY_MS ?? 500);

export async function executeRpc<T>(method: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await instrumentRpc(method, async () =>
            retry(
                async () => {
                    try {
                        return await withTimeout(fn(), RPC_TIMEOUT_MS);
                    } catch (error) {
                        throw classifyRpcError(error);
                    }
                },
                {
                    retries: RPC_MAX_RETRIES,
                    delay: RPC_RETRY_DELAY_MS,
                    factor: 2,
                    onRetry: (error, attempt, nextDelay) => {
                        recordRpcRetry(method);

                        getLogger().warn(
                            {
                                component: 'rpc',
                                method,
                                attempt,
                                nextDelayMs: nextDelay,
                                reason: error instanceof RpcError ? error.reason : 'unknown',
                                error: error instanceof Error ? error.message : String(error),
                            },
                            'Retrying blockchain RPC request',
                        );
                    },
                },
                shouldRetry,
            ),
        );
    } catch (error) {
        if (error instanceof RpcError) {
            recordRpcFailure(method, error.reason);
            getLogger().error(
                {
                    component: 'rpc',
                    method,
                    reason: error.reason,
                    retryable: error.retryable,
                    error: error.message,
                },
                'Blockchain RPC request failed',
            );
        }

        throw error;
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout;

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(new RpcTimeoutError());
                }, timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timeout!);
    }
}

export function shouldRetry(error: unknown): boolean {
    return error instanceof RpcError && error.retryable;
}

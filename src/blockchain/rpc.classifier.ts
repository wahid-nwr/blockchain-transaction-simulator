import {
    RpcError,
    RpcInvalidRequestError,
    RpcNetworkError,
    RpcRateLimitError,
    RpcRevertedError,
    RpcTimeoutError,
    RpcUnavailableError,
    RpcUnknownError,
} from './rpc.errors.js';

export function classifyRpcError(error: unknown): RpcError {
    // Already classified
    if (error instanceof RpcError) {
        return error;
    }

    if (!(error instanceof Error)) {
        return new RpcUnknownError(String(error));
    }

    const message = error.message.toLowerCase();

    // Timeout
    if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) {
        return new RpcTimeoutError(error.message);
    }

    // Connection problems
    if (
        message.includes('network') ||
        message.includes('socket') ||
        message.includes('fetch failed') ||
        message.includes('failed to fetch') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('enetunreach') ||
        message.includes('ehostunreach')
    ) {
        return new RpcNetworkError(error.message);
    }

    // Rate limiting
    if (
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('too many requests')
    ) {
        return new RpcRateLimitError(error.message);
    }

    // Service unavailable
    if (
        message.includes('503') ||
        message.includes('502') ||
        message.includes('504') ||
        message.includes('service unavailable') ||
        message.includes('temporarily unavailable')
    ) {
        return new RpcUnavailableError(error.message);
    }

    // Smart contract execution reverted
    if (
        message.includes('execution reverted') ||
        message.includes('reverted') ||
        message.includes('revert')
    ) {
        return new RpcRevertedError(error.message);
    }

    // Invalid request / parameters
    if (
        message.includes('invalid params') ||
        message.includes('invalid argument') ||
        message.includes('invalid request') ||
        message.includes('parse error') ||
        message.includes('method not found')
    ) {
        return new RpcInvalidRequestError(error.message);
    }

    return new RpcUnknownError(error.message);
}

export abstract class RpcError extends Error {
    constructor(
        message: string,
        public readonly retryable: boolean,
        public readonly reason: string,
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class RpcTimeoutError extends RpcError {
    constructor(message = 'RPC request timed out') {
        super(message, true, 'timeout');
    }
}

export class RpcNetworkError extends RpcError {
    constructor(message = 'RPC network error') {
        super(message, true, 'network');
    }
}

export class RpcRateLimitError extends RpcError {
    constructor(message = 'RPC rate limit exceeded') {
        super(message, true, 'rate_limit');
    }
}

export class RpcUnavailableError extends RpcError {
    constructor(message = 'RPC service unavailable') {
        super(message, true, 'unavailable');
    }
}

export class RpcRevertedError extends RpcError {
    constructor(message = 'Transaction reverted') {
        super(message, false, 'reverted');
    }
}

export class RpcInvalidRequestError extends RpcError {
    constructor(message = 'Invalid RPC request') {
        super(message, false, 'invalid_request');
    }
}

export class RpcUnknownError extends RpcError {
    constructor(message = 'Unknown RPC error') {
        super(message, false, 'unknown');
    }
}

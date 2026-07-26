import { AsyncLocalStorage } from 'node:async_hooks';

export interface ObservabilityContext {
    requestId?: string;

    method?: string;

    path?: string;

    tenantId?: string;

    userId?: string;

    transactionId?: string;

    tokenId?: string;

    walletId?: string;

    txHash?: string;

    blockNumber?: bigint;

    worker?: string;

    operation?: string;

    rpcMethod?: string;

    rpcStatus?: string;

    durationMs?: number;

    retryAttempt?: number;
}

const storage = new AsyncLocalStorage<ObservabilityContext>();

export function runWithContext<T>(context: ObservabilityContext, callback: () => T): T {
    return storage.run(context, callback);
}

export function getContext(): ObservabilityContext {
    return storage.getStore() ?? {};
}

export function updateContext(values: Partial<ObservabilityContext>) {
    const current = storage.getStore();

    if (!current) {
        return;
    }

    Object.assign(current, values);
}

export function clearContext() {
    storage.disable();
}

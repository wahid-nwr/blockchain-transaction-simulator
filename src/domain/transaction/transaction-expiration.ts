export const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

export function isTransactionExpired(submittedAt: Date, now: Date, timeoutMs: number): boolean {
    return now.getTime() - submittedAt.getTime() >= timeoutMs;
}

export function getTransactionExpirationTime(submittedAt: Date, timeoutMs: number): Date {
    return new Date(submittedAt.getTime() + timeoutMs);
}

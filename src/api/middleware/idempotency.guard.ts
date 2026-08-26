import { Prisma } from '@prisma/client';
import { IdempotencyService, IDEMPOTENCY_STATUS } from '../../services/idempotency.service.js';
import { AppError } from '../../common/errors/app.error.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotentHandlerResult<TResponse> {
    transactionId: string;
    response: TResponse;
}

/**
 * Wraps a mutating handler with request-level idempotency.
 *
 * If `idempotencyKey` is undefined the request proceeds unprotected — the
 * header is opt-in, not required, so this stays backward compatible with
 * existing callers.
 *
 * The `find()` check below is a convenience fast-path, not the correctness
 * mechanism: per ADR-005, application-level check-then-write is inherently
 * racy under concurrent callers. The real guarantee is the DB unique
 * constraint on `(tenantId, key)` — a losing concurrent `acquire()` throws
 * Prisma P2002, which the global error handler already turns into a clean
 * 409 for the caller.
 */
export async function withIdempotency<TResponse>(
    idempotencyService: IdempotencyService,
    params: {
        tenantId: string;
        idempotencyKey: string | undefined;
        requestHash: string;
        ttlMs?: number;
    },
    handler: () => Promise<IdempotentHandlerResult<TResponse>>,
): Promise<{ response: TResponse; replayed: boolean }> {
    const { tenantId, idempotencyKey, requestHash, ttlMs = DEFAULT_TTL_MS } = params;

    if (!idempotencyKey) {
        const { response } = await handler();
        return { response, replayed: false };
    }

    const existing = await idempotencyService.find(tenantId, idempotencyKey);

    if (existing) {
        if (existing.requestHash !== requestHash) {
            throw new AppError(
                409,
                'IDEMPOTENCY_KEY_REUSED',
                'This idempotency key was already used with a different request payload',
            );
        }

        if (existing.status === IDEMPOTENCY_STATUS.COMPLETED) {
            return { response: existing.response as TResponse, replayed: true };
        }

        if (existing.status === IDEMPOTENCY_STATUS.PROCESSING) {
            throw new AppError(
                409,
                'IDEMPOTENCY_KEY_IN_PROGRESS',
                'A request with this idempotency key is already being processed',
            );
        }

        // FAILED: known scope limit — retrying under the same key would
        // need a reset path the repository doesn't expose yet (see
        // ROADMAP). A new idempotency key is required to retry.
        throw new AppError(
            409,
            'IDEMPOTENCY_KEY_FAILED',
            'A previous request with this idempotency key failed; use a new key to retry',
        );
    }

    const acquired = await idempotencyService.acquire(tenantId, idempotencyKey, requestHash, ttlMs);

    try {
        const { transactionId, response } = await handler();

        await idempotencyService.markCompleted(
            acquired.id,
            transactionId,
            response as unknown as Prisma.InputJsonValue,
        );

        return { response, replayed: false };
    } catch (error) {
        await idempotencyService.markFailed(acquired.id, {
            error: error instanceof Error ? error.message : String(error),
        });

        throw error;
    }
}

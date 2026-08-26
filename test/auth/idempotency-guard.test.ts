import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withIdempotency } from '../../src/api/middleware/idempotency.guard.js';
import { IDEMPOTENCY_STATUS } from '../../src/services/idempotency.service.js';

const service = {
    find: vi.fn(),
    acquire: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    hashRequest: vi.fn(),
} as any;

const TENANT = 'tenant-1';
const KEY = 'client-key-abc';
const HASH = 'req-hash-abc';

const makeHandler = (result = { transactionId: 'tx-1', response: { id: 'tx-1' } }) =>
    vi.fn().mockResolvedValue(result);

beforeEach(() => vi.clearAllMocks());

describe('withIdempotency', () => {
    describe('no idempotency key (opt-out path)', () => {
        it('skips all idempotency logic and calls the handler once', async () => {
            const handler = makeHandler();

            const { response, replayed } = await withIdempotency(
                service,
                { tenantId: TENANT, idempotencyKey: undefined, requestHash: HASH },
                handler,
            );

            expect(handler).toHaveBeenCalledTimes(1);
            expect(replayed).toBe(false);
            expect(response).toEqual({ id: 'tx-1' });
            expect(service.find).not.toHaveBeenCalled();
        });
    });

    describe('first call (no existing record)', () => {
        it('acquires the key, calls the handler, marks completed, returns response', async () => {
            service.find.mockResolvedValue(null);
            service.acquire.mockResolvedValue({ id: 'idem-1' });
            service.markCompleted.mockResolvedValue({});

            const handler = makeHandler();

            const { response, replayed } = await withIdempotency(
                service,
                { tenantId: TENANT, idempotencyKey: KEY, requestHash: HASH },
                handler,
            );

            expect(service.find).toHaveBeenCalledWith(TENANT, KEY);
            expect(service.acquire).toHaveBeenCalledWith(TENANT, KEY, HASH, expect.any(Number));
            expect(handler).toHaveBeenCalledTimes(1);
            expect(service.markCompleted).toHaveBeenCalledWith('idem-1', 'tx-1', { id: 'tx-1' });
            expect(replayed).toBe(false);
            expect(response).toEqual({ id: 'tx-1' });
        });

        it('marks the record FAILED and rethrows when the handler throws', async () => {
            service.find.mockResolvedValue(null);
            service.acquire.mockResolvedValue({ id: 'idem-1' });
            service.markFailed.mockResolvedValue({});

            const handler = vi.fn().mockRejectedValue(new Error('chain error'));

            await expect(
                withIdempotency(
                    service,
                    { tenantId: TENANT, idempotencyKey: KEY, requestHash: HASH },
                    handler,
                ),
            ).rejects.toThrow('chain error');

            expect(service.markFailed).toHaveBeenCalledWith('idem-1', {
                error: 'chain error',
            });
            expect(service.markCompleted).not.toHaveBeenCalled();
        });
    });

    describe('replay path (COMPLETED record)', () => {
        it('returns the cached response without calling the handler', async () => {
            service.find.mockResolvedValue({
                requestHash: HASH,
                status: IDEMPOTENCY_STATUS.COMPLETED,
                response: { id: 'tx-1', cached: true },
            });

            const handler = makeHandler();

            const { response, replayed } = await withIdempotency(
                service,
                { tenantId: TENANT, idempotencyKey: KEY, requestHash: HASH },
                handler,
            );

            expect(handler).not.toHaveBeenCalled();
            expect(replayed).toBe(true);
            expect(response).toEqual({ id: 'tx-1', cached: true });
        });
    });

    describe('conflict paths', () => {
        it('throws 409 IDEMPOTENCY_KEY_IN_PROGRESS when status is PROCESSING', async () => {
            service.find.mockResolvedValue({
                requestHash: HASH,
                status: IDEMPOTENCY_STATUS.PROCESSING,
            });

            await expect(
                withIdempotency(
                    service,
                    { tenantId: TENANT, idempotencyKey: KEY, requestHash: HASH },
                    makeHandler(),
                ),
            ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS', statusCode: 409 });
        });

        it('throws 409 IDEMPOTENCY_KEY_FAILED when status is FAILED', async () => {
            service.find.mockResolvedValue({
                requestHash: HASH,
                status: IDEMPOTENCY_STATUS.FAILED,
            });

            await expect(
                withIdempotency(
                    service,
                    { tenantId: TENANT, idempotencyKey: KEY, requestHash: HASH },
                    makeHandler(),
                ),
            ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_FAILED', statusCode: 409 });
        });

        it('throws 409 IDEMPOTENCY_KEY_REUSED when the same key is sent with a different request hash', async () => {
            service.find.mockResolvedValue({
                requestHash: 'different-hash',
                status: IDEMPOTENCY_STATUS.COMPLETED,
            });

            await expect(
                withIdempotency(
                    service,
                    { tenantId: TENANT, idempotencyKey: KEY, requestHash: HASH },
                    makeHandler(),
                ),
            ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', statusCode: 409 });
        });
    });
});

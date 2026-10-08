import { describe, expect, it, vi } from 'vitest';

import {
    isBlockRangeLimitError,
    isRateLimitError,
    scanLogWindows,
} from '../../../src/blockchain/evm/log-windows.js';

// Shapes copied from what viem surfaces: the provider text sits several
// `cause` levels down and `message` is a generic wrapper.
function wrapped(providerMessage: string, extra: Record<string, unknown> = {}) {
    const inner = Object.assign(new Error(providerMessage), extra);
    return Object.assign(new Error('The request failed.'), {
        shortMessage: 'HTTP request failed.',
        cause: Object.assign(new Error('RPC Request failed.'), { cause: inner }),
    });
}

describe('isBlockRangeLimitError', () => {
    it.each([
        'query returned more than 10000 results',
        'block range too large',
        'eth_getLogs is limited to a 2000 block range',
        'Log response size exceeded',
        'exceed maximum block range: 5000',
        'query exceeds max results 20000',
        'limit exceeded',
        'range is too wide',
        'too many logs returned',
    ])('recognises %j as a range limit', (message) => {
        expect(isBlockRangeLimitError(wrapped(message))).toBe(true);
    });

    it.each([
        'execution reverted',
        'connect ECONNREFUSED 127.0.0.1:8545',
        'invalid argument 0: hex string without 0x prefix',
        'header not found',
    ])('does not treat %j as a range limit', (message) => {
        expect(isBlockRangeLimitError(wrapped(message))).toBe(false);
    });

    it('reads the provider text from deep in the cause chain', () => {
        expect(isBlockRangeLimitError(wrapped('block range too large'))).toBe(true);
    });

    it('never treats rate limiting as a range problem, even under the shared -32005 code', () => {
        expect(
            isBlockRangeLimitError(
                wrapped('request rate limited: limit exceeded', { code: -32005 }),
            ),
        ).toBe(false);
        expect(isBlockRangeLimitError(wrapped('Too Many Requests', { status: 429 }))).toBe(false);
        expect(isBlockRangeLimitError(wrapped('daily request count exceeded'))).toBe(false);
    });

    it('survives non-error and cyclic input', () => {
        const cyclic: { cause?: unknown; message: string } = { message: 'x' };
        cyclic.cause = cyclic;

        expect(isBlockRangeLimitError(undefined)).toBe(false);
        expect(isBlockRangeLimitError('block range too large')).toBe(false);
        expect(isBlockRangeLimitError(cyclic)).toBe(false);
    });
});

describe('isRateLimitError', () => {
    it('flags 429 and rate-limit wording', () => {
        expect(isRateLimitError(wrapped('Too Many Requests', { status: 429 }))).toBe(true);
        expect(isRateLimitError(wrapped('rate limit reached'))).toBe(true);
        expect(isRateLimitError(wrapped('block range too large'))).toBe(false);
    });
});

describe('scanLogWindows', () => {
    const run = async (opts: {
        from: bigint;
        to: bigint;
        maxRange: bigint;
        maxWindows?: number;
        fetch?: (from: bigint, to: bigint) => Promise<string[]>;
    }) => {
        const windowsSeen: Array<[bigint, bigint]> = [];

        const fetch = vi.fn(opts.fetch ?? (async () => []));

        const result = await scanLogWindows<string>({
            from: opts.from,
            to: opts.to,
            maxRange: opts.maxRange,
            maxWindows: opts.maxWindows ?? 1000,
            fetch,
            onWindow: async (_logs, range) => {
                windowsSeen.push([range.from, range.to]);
            },
        });

        return { result, windowsSeen, fetch };
    };

    it('covers [from, to] with contiguous, non-overlapping windows', async () => {
        const { result, windowsSeen } = await run({ from: 0n, to: 9n, maxRange: 4n });

        expect(windowsSeen).toEqual([
            [0n, 3n],
            [4n, 7n],
            [8n, 9n],
        ]);
        expect(result).toMatchObject({ lastProcessed: 9n, complete: true, windows: 3 });
    });

    it('uses a single window when the range fits', async () => {
        const { windowsSeen, fetch } = await run({ from: 5n, to: 5n, maxRange: 2000n });

        expect(windowsSeen).toEqual([[5n, 5n]]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does nothing for an empty range', async () => {
        const { result, fetch } = await run({ from: 10n, to: 9n, maxRange: 100n });

        expect(fetch).not.toHaveBeenCalled();
        expect(result).toMatchObject({ lastProcessed: null, complete: true, windows: 0 });
    });

    it('stops at maxWindows and reports the scan as incomplete, resumable from lastProcessed + 1', async () => {
        const { result, windowsSeen } = await run({
            from: 0n,
            to: 99n,
            maxRange: 10n,
            maxWindows: 3,
        });

        expect(windowsSeen).toEqual([
            [0n, 9n],
            [10n, 19n],
            [20n, 29n],
        ]);
        expect(result).toMatchObject({ lastProcessed: 29n, complete: false, windows: 3 });
    });

    it('hands each window its own logs', async () => {
        const onWindow = vi.fn(async () => undefined);

        await scanLogWindows<string>({
            from: 0n,
            to: 3n,
            maxRange: 2n,
            maxWindows: 10,
            fetch: async (from) => [`log@${from}`],
            onWindow,
        });

        expect(onWindow).toHaveBeenNthCalledWith(1, ['log@0'], { from: 0n, to: 1n });
        expect(onWindow).toHaveBeenNthCalledWith(2, ['log@2'], { from: 2n, to: 3n });
    });

    it('halves the window on a range-limit error and retries from the same start block', async () => {
        const fetch = vi.fn(async (from: bigint, to: bigint) => {
            if (to - from + 1n > 4n) {
                throw wrapped('block range too large');
            }
            return [];
        });
        const onShrink = vi.fn();
        const seen: Array<[bigint, bigint]> = [];

        const result = await scanLogWindows<string>({
            from: 0n,
            to: 15n,
            maxRange: 16n,
            maxWindows: 100,
            fetch,
            onWindow: async (_l, r) => {
                seen.push([r.from, r.to]);
            },
            onShrink,
        });

        // 16 -> 8 -> 4, then stays at 4.
        expect(onShrink.mock.calls.map((c) => c[0])).toEqual([8n, 4n]);
        expect(seen[0]).toEqual([0n, 3n]);
        expect(seen.at(-1)).toEqual([12n, 15n]);
        expect(result).toMatchObject({ complete: true, maxRange: 4n });
    });

    it('does not count failed attempts as windows', async () => {
        let first = true;
        const { result } = await run({
            from: 0n,
            to: 7n,
            maxRange: 8n,
            maxWindows: 2,
            fetch: async (from, to) => {
                if (first && to - from + 1n > 4n) {
                    first = false;
                    throw wrapped('block range too large');
                }
                return [];
            },
        });

        expect(result).toMatchObject({ windows: 2, complete: true, lastProcessed: 7n });
    });

    it('rethrows a rate-limit error instead of shrinking', async () => {
        const onShrink = vi.fn();

        await expect(
            scanLogWindows<string>({
                from: 0n,
                to: 100n,
                maxRange: 50n,
                maxWindows: 10,
                fetch: async () => {
                    throw wrapped('Too Many Requests', { status: 429 });
                },
                onWindow: async () => undefined,
                onShrink,
            }),
        ).rejects.toThrow();

        expect(onShrink).not.toHaveBeenCalled();
    });

    it('rethrows a range error once the window cannot shrink further', async () => {
        const fetch = vi.fn(async () => {
            throw wrapped('block range too large');
        });

        await expect(
            scanLogWindows<string>({
                from: 0n,
                to: 10n,
                maxRange: 4n,
                maxWindows: 10,
                fetch,
                onWindow: async () => undefined,
            }),
        ).rejects.toThrow();

        // 4 -> 2 -> 1, then the size-1 attempt fails for good.
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('stops at a window whose handler throws, leaving earlier windows done', async () => {
        const done: bigint[] = [];

        await expect(
            scanLogWindows<string>({
                from: 0n,
                to: 29n,
                maxRange: 10n,
                maxWindows: 10,
                fetch: async () => [],
                onWindow: async (_l, r) => {
                    if (r.from === 10n) {
                        throw new Error('handler failed');
                    }
                    done.push(r.to);
                },
            }),
        ).rejects.toThrow('handler failed');

        expect(done).toEqual([9n]);
    });
});

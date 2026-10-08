/**
 * Bounded, self-tuning eth_getLogs scanning.
 *
 * A single getLogs over [cursor, head] is fine on a local node and fatal on a
 * real chain: after any downtime, or on a fresh database, the span can be
 * hundreds of thousands of blocks, and public RPCs reject spans (or result
 * counts) above a provider-specific limit. This module walks the range in
 * windows, halves the window when the provider says it is too big, and hands
 * each window's logs to the caller so progress can be persisted per window.
 *
 * Deliberately free of viem imports (errors are duck-typed): it is pure logic
 * that is unit-tested without a chain.
 */

// Rate limiting must be recognised FIRST and must not shrink the window: some
// providers report both "range too large" and "rate limited" under the same
// JSON-RPC code (-32005), so the code alone cannot tell them apart.
const RATE_LIMIT_PATTERN = /rate.?limit|too many requests|request(s)? (count|per)|throttl|\b429\b/i;

const RANGE_LIMIT_PATTERN =
    /block range|range (is )?too (large|wide|big)|(exceed|exceeds|exceeded)[^.]{0,40}(range|limit|results|size)|more than \d+ results|too many (results|logs)|response size|query (returned|exceeds)|limit exceeded|max(imum)? (block )?range|logs? (response|result)s? (is )?too/i;

function collectErrorText(error: unknown): string {
    const parts: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;

    // Walk the cause chain: viem wraps the provider's message several layers deep.
    while (current && typeof current === 'object' && !seen.has(current) && parts.length < 10) {
        seen.add(current);

        const e = current as {
            message?: unknown;
            shortMessage?: unknown;
            details?: unknown;
            status?: unknown;
            cause?: unknown;
        };

        for (const field of [e.message, e.shortMessage, e.details]) {
            if (typeof field === 'string') {
                parts.push(field);
            }
        }

        if (typeof e.status === 'number') {
            parts.push(`status ${e.status}`);
        }

        current = e.cause;
    }

    return parts.join(' | ');
}

export function isRateLimitError(error: unknown): boolean {
    return RATE_LIMIT_PATTERN.test(collectErrorText(error));
}

/** True only when retrying with a smaller block range could succeed. */
export function isBlockRangeLimitError(error: unknown): boolean {
    const text = collectErrorText(error);

    if (RATE_LIMIT_PATTERN.test(text)) {
        return false;
    }

    return RANGE_LIMIT_PATTERN.test(text);
}

export interface ScanLogWindowsParams<TLog> {
    /** Inclusive. */
    from: bigint;
    /** Inclusive. */
    to: bigint;
    maxRange: bigint;
    /** Stop after this many successful windows; the caller continues next cycle. */
    maxWindows: number;
    fetch: (from: bigint, to: bigint) => Promise<TLog[]>;
    /** Persist a window's results. Throwing aborts the scan with that window unprocessed. */
    onWindow: (logs: TLog[], range: { from: bigint; to: bigint }) => Promise<void>;
    onShrink?: (newRange: bigint, error: unknown) => void;
}

export interface ScanLogWindowsResult {
    /** Last block fully handled, or null if no window completed. */
    lastProcessed: bigint | null;
    /** True when the scan reached `to`; false when it stopped at `maxWindows`. */
    complete: boolean;
    windows: number;
    /** The window size in force at the end, so callers can remember a learned limit. */
    maxRange: bigint;
}

export async function scanLogWindows<TLog>(
    params: ScanLogWindowsParams<TLog>,
): Promise<ScanLogWindowsResult> {
    let from = params.from;
    let size = params.maxRange;
    let windows = 0;
    let lastProcessed: bigint | null = null;

    while (from <= params.to && windows < params.maxWindows) {
        const end = from + size - 1n < params.to ? from + size - 1n : params.to;

        let logs: TLog[];

        try {
            logs = await params.fetch(from, end);
        } catch (error) {
            // Halve and retry the same start block. Anything that is not a
            // range-limit error (including rate limiting) propagates, and so
            // does a range error at size 1, where there is nothing left to cut.
            if (size > 1n && isBlockRangeLimitError(error)) {
                size = size / 2n;
                params.onShrink?.(size, error);
                continue;
            }

            throw error;
        }

        await params.onWindow(logs, { from, to: end });

        lastProcessed = end;
        from = end + 1n;
        windows += 1;
    }

    return {
        lastProcessed,
        complete: from > params.to,
        windows,
        maxRange: size,
    };
}

import { describe, it, expect, vi } from 'vitest';

import { retry } from '../../src/utils/retry.js';

describe('retry', () => {
    it('should return result when first attempt succeeds', async () => {
        const operation = vi.fn().mockResolvedValue('success');

        const result = await retry(operation, {
            retries: 0,
            delay: 1,
        });

        expect(result).toBe('success');

        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry failed operations', async () => {
        const operation = vi
            .fn()
            .mockRejectedValueOnce(new Error('temporary'))
            .mockResolvedValue('success');

        const result = await retry(operation, {
            retries: 1,
            delay: 1,
        });

        expect(result).toBe('success');

        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw after retries exhausted', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('RPC failed'));

        await expect(
            retry(operation, {
                retries: 2,
                delay: 1,
            }),
        ).rejects.toThrow('RPC failed');

        expect(operation).toHaveBeenCalledTimes(3);
    });
});

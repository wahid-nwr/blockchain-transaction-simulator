import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TokenEventCursorRepository } from '../../src/repositories/token-event-cursor.repository.js';
import { prisma } from '../../src/database/prisma.js';

vi.mock('../../src/database/prisma.js', () => ({
    prisma: {
        tokenEventCursor: {
            upsert: vi.fn(),
        },
    },
}));

describe('TokenEventCursorRepository', () => {
    const repository = new TokenEventCursorRepository();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create cursor when missing', async () => {
        vi.mocked(prisma.tokenEventCursor.upsert).mockResolvedValue({
            id: 'cursor-1',
            tokenId: 'token-1',
            lastProcessedBlock: 0n,
        } as any);

        const result = await repository.getOrCreate('token-1');

        expect(prisma.tokenEventCursor.upsert).toHaveBeenCalledWith({
            where: {
                tokenId: 'token-1',
            },
            create: {
                tokenId: 'token-1',
                lastProcessedBlock: 0n,
            },
            update: {},
        });

        expect(result.tokenId).toBe('token-1');
    });
});

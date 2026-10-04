import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRawMock, getBlockNumberMock, getChainIdMock } = vi.hoisted(() => ({
    queryRawMock: vi.fn(),
    getBlockNumberMock: vi.fn(),
    getChainIdMock: vi.fn(),
}));

vi.mock('../../src/database/prisma.js', () => ({
    prisma: { $queryRaw: queryRawMock },
}));

vi.mock('../../src/blockchain/client.js', () => ({
    publicClient: {
        getBlockNumber: getBlockNumberMock,
        getChainId: getChainIdMock,
    },
}));

vi.mock('../../src/observability/logger.js', () => ({
    getLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { checkReadiness } from '../../src/api/health/readiness.service.js';

describe('checkReadiness RPC chain verification', () => {
    beforeEach(() => {
        queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
        getBlockNumberMock.mockResolvedValue(10n);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('is ready when the RPC serves the configured chain (default 31337)', async () => {
        getChainIdMock.mockResolvedValue(31337);

        const result = await checkReadiness();

        expect(result.healthy).toBe(true);
        expect(result.checks.rpc).toBe('ok');
    });

    it('is not ready when the RPC serves a different chain than EVM_CHAIN_ID', async () => {
        vi.stubEnv('EVM_CHAIN_ID', '46630');
        getChainIdMock.mockResolvedValue(31337);

        const result = await checkReadiness();

        expect(result.healthy).toBe(false);
        expect(result.status).toBe('not_ready');
        expect(result.checks.rpc).toBe('chain_mismatch');
    });

    it('is ready against Robinhood Chain testnet when configured for it', async () => {
        vi.stubEnv('EVM_CHAIN_ID', '46630');
        getChainIdMock.mockResolvedValue(46630);

        const result = await checkReadiness();

        expect(result.checks.rpc).toBe('ok');
    });

    it('still reports rpc failed when the node is unreachable', async () => {
        getBlockNumberMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

        const result = await checkReadiness();

        expect(result.healthy).toBe(false);
        expect(result.checks.rpc).toBe('failed');
    });
});

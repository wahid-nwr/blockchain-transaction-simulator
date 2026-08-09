import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/blockchain/client.js', () => ({
    getWalletClient: vi.fn(),
    publicClient: {
        waitForTransactionReceipt: vi.fn(),
    },
}));

import { MintService } from '../../src/services/mint.service.js';
import { getWalletClient, publicClient } from '../../src/blockchain/client.js';

describe('MintService', () => {
    let service: MintService;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv(
            'PRIVATE_KEY',
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        );
        service = new MintService();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('should mint tokens successfully', async () => {
        const writeContract = vi.fn().mockResolvedValue('0xtxhash');

        vi.mocked(getWalletClient).mockReturnValue({
            writeContract,
        } as any);

        vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValue({
            transactionHash: '0xtxhash',
            status: 'success',
        } as any);

        const result = await service.mint('0xtoken', '0xreceiver', 1000000n);

        expect(getWalletClient).toHaveBeenCalledWith(
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        );
        expect(writeContract).toHaveBeenCalledTimes(1);

        const call = writeContract.mock.calls[0][0];

        expect(call.address).toBe('0xtoken');
        expect(call.functionName).toBe('mint');
        expect(call.args).toEqual(['0xreceiver', 1000000n]);

        expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({
            hash: '0xtxhash',
        });

        expect(result.status).toBe('success');
    });

    it('should propagate blockchain write failure', async () => {
        const error = new Error('RPC failure');

        vi.mocked(getWalletClient).mockReturnValue({
            writeContract: vi.fn().mockRejectedValue(error),
        } as any);

        await expect(service.mint('0xtoken', '0xreceiver', 1000n)).rejects.toThrow('RPC failure');

        expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it('should propagate receipt failure', async () => {
        vi.mocked(getWalletClient).mockReturnValue({
            writeContract: vi.fn().mockResolvedValue('0xtxhash'),
        } as any);

        vi.mocked(publicClient.waitForTransactionReceipt).mockRejectedValue(
            new Error('Receipt timeout'),
        );

        await expect(service.mint('0xtoken', '0xreceiver', 1000n)).rejects.toThrow(
            'Receipt timeout',
        );
    });

    it('throws a clear error when PRIVATE_KEY is not configured', async () => {
        vi.stubEnv('PRIVATE_KEY', '');

        await expect(service.mint('0xtoken', '0xreceiver', 1000n)).rejects.toThrow(
            'PRIVATE_KEY is not configured',
        );

        expect(getWalletClient).not.toHaveBeenCalled();
    });
});

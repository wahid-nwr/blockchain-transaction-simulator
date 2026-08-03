import { describe, it, expect, vi, beforeEach } from 'vitest';

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

    const privateKey = '0x59c6995e998f97a5a0044966f094538e5d9d3154b79b6c8b8b6d5a8f8f8f';

    beforeEach(() => {
        vi.clearAllMocks();
        service = new MintService();
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

        const result = await service.mint('0xtoken', '0xreceiver', 1000000n, privateKey);

        expect(getWalletClient).toHaveBeenCalledWith(privateKey);
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

        await expect(service.mint('0xtoken', '0xreceiver', 1000n, privateKey)).rejects.toThrow(
            'RPC failure',
        );

        expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it('should propagate receipt failure', async () => {
        vi.mocked(getWalletClient).mockReturnValue({
            writeContract: vi.fn().mockResolvedValue('0xtxhash'),
        } as any);

        vi.mocked(publicClient.waitForTransactionReceipt).mockRejectedValue(
            new Error('Receipt timeout'),
        );

        await expect(service.mint('0xtoken', '0xreceiver', 1000n, privateKey)).rejects.toThrow(
            'Receipt timeout',
        );
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MintService } from '../../src/services/mint.service.js';

vi.mock('viem/accounts', () => ({
    privateKeyToAccount: vi.fn(),
}));

vi.mock('viem', () => ({
    createWalletClient: vi.fn(),
    createPublicClient: vi.fn(),
    http: vi.fn(() => 'http-transport'),
}));

import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient } from 'viem';

describe('MintService', () => {
    let service: MintService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.DEPLOYER_PRIVATE_KEY = '0x1234567890abcdef';
        process.env.RPC_URL = 'http://localhost:8545';
        service = new MintService();
    });

    it('should mint tokens successfully', async () => {
        const writeContract = vi.fn().mockResolvedValue('0xtxhash');

        const waitForTransactionReceipt = vi.fn().mockResolvedValue({
            transactionHash: '0xtxhash',
            status: 'success',
        });

        (privateKeyToAccount as any).mockReturnValue({
            address: '0xdeployer',
        });

        (createWalletClient as any).mockReturnValue({
            writeContract,
        });

        (createPublicClient as any).mockReturnValue({
            waitForTransactionReceipt,
        });

        const result = await service.mint('0xtoken', '0xreceiver', 1000000n);

        expect(privateKeyToAccount).toHaveBeenCalledWith('0x1234567890abcdef');

        expect(writeContract).toHaveBeenCalledWith(
            expect.objectContaining({
                address: '0xtoken',
                functionName: 'mint',
                args: ['0xreceiver', 1000000n],
            }),
        );

        expect(waitForTransactionReceipt).toHaveBeenCalledWith({
            hash: '0xtxhash',
        });

        expect(result).toEqual({
            transactionHash: '0xtxhash',
            status: 'success',
        });
    });

    it('should propagate blockchain write failure', async () => {
        const error = new Error('RPC failure');

        const writeContract = vi.fn().mockRejectedValue(error);

        (privateKeyToAccount as any).mockReturnValue({
            address: '0xdeployer',
        });

        (createWalletClient as any).mockReturnValue({
            writeContract,
        });

        const waitForTransactionReceipt = vi.fn();

        (createPublicClient as any).mockReturnValue({
            waitForTransactionReceipt,
        });

        await expect(service.mint('0xtoken', '0xreceiver', 1000n)).rejects.toThrow('RPC failure');

        expect(waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it('should propagate receipt failure', async () => {
        const writeContract = vi.fn().mockResolvedValue('0xtxhash');

        const waitForTransactionReceipt = vi.fn().mockRejectedValue(new Error('Receipt timeout'));

        (privateKeyToAccount as any).mockReturnValue({
            address: '0xdeployer',
        });

        (createWalletClient as any).mockReturnValue({
            writeContract,
        });

        (createPublicClient as any).mockReturnValue({
            waitForTransactionReceipt,
        });

        await expect(service.mint('0xtoken', '0xreceiver', 1000n)).rejects.toThrow(
            'Receipt timeout',
        );

        expect(writeContract).toHaveBeenCalled();
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publicClient } from '../../../src/blockchain/client.js';
import { EvmTokenBalanceReader } from '../../../src/blockchain/evm/evm-token-balance-reader.js';

describe('EvmTokenBalanceReader', () => {
    let reader: EvmTokenBalanceReader;

    beforeEach(() => {
        vi.clearAllMocks();

        reader = new EvmTokenBalanceReader();
    });

    it('should read ERC-20 balance at the requested block', async () => {
        vi.spyOn(publicClient, 'readContract').mockResolvedValue(12345n as never);

        const result = await reader.getTokenBalance({
            walletAddress: '0x0000000000000000000000000000000000000001',
            assetIdentifier: '0x0000000000000000000000000000000000000002',
            blockNumber: 100n,
        });

        expect(publicClient.readContract).toHaveBeenCalledWith({
            address: '0x0000000000000000000000000000000000000002',
            abi: expect.any(Array),
            functionName: 'balanceOf',
            args: ['0x0000000000000000000000000000000000000001'],
            blockNumber: 100n,
        });

        expect(result).toEqual({
            balance: 12345n,
            blockNumber: 100n,
        });
    });

    it('should propagate RPC errors', async () => {
        const error = new Error('RPC unavailable');

        vi.spyOn(publicClient, 'readContract').mockRejectedValue(error);

        await expect(
            reader.getTokenBalance({
                walletAddress: '0x0000000000000000000000000000000000000001',
                assetIdentifier: '0x0000000000000000000000000000000000000002',
                blockNumber: 100n,
            }),
        ).rejects.toThrow('RPC unavailable');
    });

    it('should reject a balance read without a block number', async () => {
        await expect(
            reader.getTokenBalance({
                walletAddress: '0x0000000000000000000000000000000000000001',
                assetIdentifier: '0x0000000000000000000000000000000000000002',
            }),
        ).rejects.toThrow('EVM token balance requires a block number');

        expect(publicClient.readContract).not.toHaveBeenCalled();
    });
});

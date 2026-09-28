import { describe, expect, it, vi } from 'vitest';

import { publicClient } from '../../../src/blockchain/client.js';
import { EvmAdapter } from '../../../src/blockchain/evm/evm.adapter.js';

function makeSigner() {
    return { getWalletClientFor: vi.fn() } as never;
}

describe('EvmAdapter', () => {
    it('validates well-formed EVM addresses and rejects malformed ones', () => {
        const adapter = new EvmAdapter(makeSigner(), { mint: vi.fn() } as never);

        expect(adapter.validateAssetIdentifier('0x5FbDB2315678afecb367f032d93F642f64180aa3')).toBe(
            true,
        );
        expect(adapter.validateAssetIdentifier('not-an-address')).toBe(false);
        expect(adapter.validateAssetIdentifier('')).toBe(false);
    });

    it('delegates mint to MintService and maps its receipt to a MintResult', async () => {
        const mintServiceMock = {
            mint: vi.fn().mockResolvedValue({
                transactionHash: '0xhash',
                status: 'success',
            }),
        };

        const adapter = new EvmAdapter(makeSigner(), mintServiceMock as never);

        const result = await adapter.mint({
            assetIdentifier: '0xtoken',
            toAddress: '0xreceiver',
            amount: 1000n,
        });

        expect(mintServiceMock.mint).toHaveBeenCalledWith('0xtoken', '0xreceiver', 1000n);
        expect(result).toEqual({ txHash: '0xhash' });
    });

    it('propagates a mint failure from MintService', async () => {
        const mintServiceMock = {
            mint: vi.fn().mockRejectedValue(new Error('RPC failure')),
        };

        const adapter = new EvmAdapter(makeSigner(), mintServiceMock as never);

        await expect(
            adapter.mint({ assetIdentifier: '0xtoken', toAddress: '0xreceiver', amount: 1000n }),
        ).rejects.toThrow('RPC failure');
    });

    describe('getTokenBalance', () => {
        const walletAddress = '0x0000000000000000000000000000000000000001';
        const assetIdentifier = '0x0000000000000000000000000000000000000002';

        it('reads the ERC-20 balance at the requested block', async () => {
            const readContract = vi
                .spyOn(publicClient, 'readContract')
                .mockResolvedValue(12345n as never);

            const adapter = new EvmAdapter(makeSigner(), { mint: vi.fn() } as never);

            const result = await adapter.getTokenBalance({
                walletAddress,
                assetIdentifier,
                blockNumber: 100n,
            });

            expect(readContract).toHaveBeenCalledWith(
                expect.objectContaining({
                    address: assetIdentifier,
                    functionName: 'balanceOf',
                    args: [walletAddress],
                    blockNumber: 100n,
                }),
            );
            expect(result).toEqual({ balance: 12345n, blockNumber: 100n });
        });

        it('reads the latest state and reports the observed block when none is given', async () => {
            const readContract = vi
                .spyOn(publicClient, 'readContract')
                .mockResolvedValue(7n as never);
            vi.spyOn(publicClient, 'getBlockNumber').mockResolvedValue(321n);

            const adapter = new EvmAdapter(makeSigner(), { mint: vi.fn() } as never);

            const result = await adapter.getTokenBalance({ walletAddress, assetIdentifier });

            expect(readContract).toHaveBeenCalledWith(
                expect.not.objectContaining({ blockNumber: expect.anything() }),
            );
            expect(result).toEqual({ balance: 7n, blockNumber: 321n });
        });

        it('requires an asset identifier', async () => {
            const readContract = vi.spyOn(publicClient, 'readContract');
            readContract.mockClear();

            const adapter = new EvmAdapter(makeSigner(), { mint: vi.fn() } as never);

            await expect(adapter.getTokenBalance({ walletAddress })).rejects.toThrow(
                'EVM token balance requires an asset contract address',
            );
            expect(readContract).not.toHaveBeenCalled();
        });
    });
});

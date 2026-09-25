import { describe, expect, it, vi } from 'vitest';

import { EvmAdapter } from '../../../src/blockchain/evm/evm.adapter.js';

function makeSigner() {
    return { getWalletClientFor: vi.fn() } as never;
}

describe('EvmAdapter', () => {
    it('validates well-formed EVM addresses and rejects malformed ones', () => {
        const adapter = new EvmAdapter(makeSigner(), { mint: vi.fn() } as never);

        expect(
            adapter.validateAssetIdentifier('0x5FbDB2315678afecb367f032d93F642f64180aa3'),
        ).toBe(true);
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
});

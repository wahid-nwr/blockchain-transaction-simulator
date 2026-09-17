import { describe, expect, it, vi } from 'vitest';

import { BitcoinAdapter } from '../../../src/blockchain/bitcoin/bitcoin.adapter.js';

describe('BitcoinAdapter', () => {
    it('submits a transfer using BTC amount', async () => {
        const rpc = {
            call: vi.fn().mockResolvedValue('bitcoin-tx-hash'),
        };

        const adapter = new BitcoinAdapter(rpc as never);

        const result = await adapter.submitTransfer({
            tenantId: 'tenant-1',
            walletId: 'wallet-1',
            toAddress: 'bcrt1qrecipient',
            amount: 123456789n,
        });

        expect(result).toEqual({
            txHash: 'bitcoin-tx-hash',
        });

        expect(rpc.call).toHaveBeenCalledWith(
            'sendtoaddress',
            ['bcrt1qrecipient', 1.23456789],
            true,
        );
    });

    it('maps an unconfirmed transaction as pending, not failed', async () => {
        const rpc = {
            call: vi.fn().mockResolvedValue({
                confirmations: 0,
            }),
        };

        const adapter = new BitcoinAdapter(rpc as never);

        await expect(adapter.getTransaction('bitcoin-tx-hash')).resolves.toEqual({
            txHash: 'bitcoin-tx-hash',
            blockNumber: null,
            confirmations: 0,
            status: 'pending',
            gasUsed: null,
        });
    });

    it('maps a mempool transaction with no confirmations field at all as pending', async () => {
        // getrawtransaction omits `confirmations` entirely for a
        // mempool-only transaction rather than returning 0 explicitly.
        const rpc = {
            call: vi.fn().mockResolvedValue({}),
        };

        const adapter = new BitcoinAdapter(rpc as never);

        await expect(adapter.getTransaction('bitcoin-tx-hash')).resolves.toEqual({
            txHash: 'bitcoin-tx-hash',
            blockNumber: null,
            confirmations: 0,
            status: 'pending',
            gasUsed: null,
        });
    });

    it('maps a confirmed transaction', async () => {
        const rpc = {
            call: vi.fn().mockResolvedValue({
                confirmations: 6,
                blockhash: 'block-hash',
                blockheight: 123n,
            }),
        };

        const adapter = new BitcoinAdapter(rpc as never);

        await expect(adapter.getTransaction('bitcoin-tx-hash')).resolves.toEqual({
            txHash: 'bitcoin-tx-hash',
            blockNumber: 123n,
            confirmations: 6,
            status: 'confirmed',
            gasUsed: null,
        });
    });

    it('rejects an amount above Bitcoin maximum supply', async () => {
        const rpc = {
            call: vi.fn(),
        };

        const adapter = new BitcoinAdapter(rpc as never);

        await expect(
            adapter.submitTransfer({
                tenantId: 'tenant-1',
                walletId: 'wallet-1',
                toAddress: 'bcrt1qrecipient',
                amount: 2_100_000_000_000_001n,
            }),
        ).rejects.toThrow('Bitcoin transfer amount exceeds maximum supply');

        expect(rpc.call).not.toHaveBeenCalled();
    });
});

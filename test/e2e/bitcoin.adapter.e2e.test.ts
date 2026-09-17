import { describe, expect, it } from 'vitest';

import { BitcoinAdapter } from '../../src/blockchain/bitcoin/bitcoin.adapter.js';
import { BitcoinRpcClient } from '../../src/blockchain/bitcoin/rpc.client.js';

import {
    getBitcoinNewAddress,
    getBitcoinTransaction,
    waitForBitcoin,
} from './helpers/bitcoin.js';

describe('BitcoinAdapter E2E', () => {
    it('submits a real regtest transaction through Bitcoin Core', async () => {
        await waitForBitcoin();

        const receiverAddress = await getBitcoinNewAddress();

        const adapter = new BitcoinAdapter(new BitcoinRpcClient());

        const result = await adapter.submitTransfer({
            tenantId: 'e2e-tenant',
            walletId: 'e2e-wallet',
            toAddress: receiverAddress,
            amount: 10_000n,
        });

        expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);

        const transaction = await getBitcoinTransaction(result.txHash);

        console.log(JSON.stringify(transaction, null, 2));
        expect(transaction.confirmations ?? 0).toBe(0);
        expect(transaction.blockheight).toBeUndefined();
    });
});

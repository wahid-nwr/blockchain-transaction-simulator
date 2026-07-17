import {
    describe,
    it,
    expect,
    vi,
    beforeEach
} from "vitest";
import { TransferService } from "../../src/services/transfer.service.js";
import { LedgerService } from "../../src/services/ledger.service.js";

vi.mock(
    "../../src/blockchain/client.js",
    () => ({
        walletClient: {
            writeContract: vi.fn()
        }
    })
);

import { walletClient } from "../../src/blockchain/client.js";

describe("TransferService", () => {
    const ledgerMock = {
        createPending: vi.fn(),
        attachHash: vi.fn(),
        markFailed: vi.fn()
    };

    let service: TransferService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TransferService(
            ledgerMock as unknown as LedgerService
        );
    });

    it ("should create pending transaction and attach blockchain hash", async () => {
        ledgerMock.createPending
            .mockResolvedValue({
                id:"tx-123"
            });

        (walletClient.writeContract as any)
            .mockResolvedValue(
                "0xtransactionhash"
            );

        ledgerMock.attachHash
            .mockResolvedValue({
                id:"tx-123",
                txHash:"0xtransactionhash"
            });

        const result = await service.transfer({
            tenantId:"tenant-1",
            tokenId:"token-1",
            fromWalletId:"wallet-1",
            toWalletId:"wallet-2",
            amount:1000n,
            account:"0xabc",
            to:"0xdef"
        });

        expect(ledgerMock.createPending).toHaveBeenCalled();

        expect(walletClient.writeContract).toHaveBeenCalled();

        expect(ledgerMock.attachHash).toHaveBeenCalledWith(
            "tx-123",
            "0xtransactionhash"
        );

        expect(result)
            .toEqual({
                id:"tx-123",
                txHash:"0xtransactionhash"
            });
    });

    it ("should mark transaction failed when blockchain transfer fails",
        async () => {


            ledgerMock.createPending
                .mockResolvedValue({
                    id:"tx-123"
                });


            const error =
                new Error(
                    "RPC failure"
                );


            (walletClient.writeContract as any)
                .mockRejectedValue(
                    error
                );


            await expect(
                service.transfer({

                    tenantId:"tenant-1",

                    tokenId:"token-1",

                    fromWalletId:"wallet-1",

                    toWalletId:"wallet-2",

                    amount:1000n,

                    account:"0xabc",

                    to:"0xdef"

                })
)
.rejects
.toThrow(
                "RPC failure"
            );



            expect(
                ledgerMock.markFailed
)
.toHaveBeenCalledWith(
                "tx-123"
            );

        });


});
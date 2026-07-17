import {
    describe,
    it,
    expect,
    vi,
    beforeEach
} from "vitest";
import { ConfirmationWorker } from "../../src/workers/confirmation.worker.js";
import { TransactionRepository } from "../../src/repositories/transaction.repository.js";

vi.mock(
    "../../src/blockchain/client.js",
    () => ({
        publicClient: {
            getTransactionReceipt: vi.fn()
        }
    })
);

import { publicClient } from "../../src/blockchain/client.js";

describe("ConfirmationWorker", () => {
    const repoMock = {
        findPending: vi.fn(),
        confirm: vi.fn(),
        updateStatus: vi.fn()
    };

    let worker: ConfirmationWorker;

    beforeEach(() => {
        vi.clearAllMocks();
        worker = new ConfirmationWorker(
            repoMock as unknown as TransactionRepository
        );
    });

    it ("should confirm successful blockchain transaction",
        async () => {
            repoMock.findPending
                .mockResolvedValue([
                    {
                        id: "tx-1",
                        txHash: "0xhash"
                    }
                ]);

            (publicClient.getTransactionReceipt as any)
                .mockResolvedValue({
                    status: "success",
                    blockNumber: 100n,
                    gasUsed: 50000n
                });

            await worker.process();

            expect(publicClient.getTransactionReceipt).toHaveBeenCalledWith({
                hash: "0xhash"
            });

            expect(repoMock.confirm).toHaveBeenCalledWith(
                "0xhash",
                {
                    blockNumber: 100,
                    gasUsed: 50000n
                }
            );
        }
    );

    it ("should mark transaction failed when receipt fails",
        async () => {
            repoMock.findPending
                .mockResolvedValue([
                    {
                        id: "tx-1",
                        txHash: "0xhash"
                    }
                ]);

            (publicClient.getTransactionReceipt as any)
                .mockResolvedValue({
                    status: "reverted",
                    blockNumber: 100n,
                    gasUsed: 50000n
                });

            await worker.process();

            expect(repoMock.updateStatus).toHaveBeenCalledWith(
                "0xhash",
                "FAILED"
            );
        }
    );

    it ("should ignore pending transaction without hash",
        async () => {
            repoMock.findPending
                .mockResolvedValue([
                    {
                        id: "tx-1",
                        txHash: null
                    }
                ]);

            await worker.process();

            expect(publicClient.getTransactionReceipt)
                .not
                .toHaveBeenCalled();

            expect(repoMock.confirm)
                .not
                .toHaveBeenCalled();
        }
    );
});
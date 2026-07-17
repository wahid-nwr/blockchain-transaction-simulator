import {
    describe,
    it,
    expect,
    vi,
    beforeEach
} from "vitest";
import { BalanceSyncService } from "../../src/services/balance-sync.service.js";
import { BalanceRepository } from "../../src/repositories/balance.repository.js";

vi.mock(
    "../../src/blockchain/client.js",
    () => ({
        publicClient: {
            readContract: vi.fn()
        }
    })
);

import { publicClient } from "../../src/blockchain/client.js";

describe("BalanceSyncService", () => {
    const repositoryMock = {
        upsert: vi.fn()
    };

    let service: BalanceSyncService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new BalanceSyncService(
            repositoryMock as unknown as BalanceRepository
        );
    });

    it ("should read blockchain balance and persist snapshot",
        async () => {
            (publicClient.readContract as any)
                .mockResolvedValue(
                    5000n
                );

            repositoryMock.upsert
                .mockResolvedValue({
                    walletId: "wallet-1",
                    tokenId: "token-1",
                    balance: 5000n,
                    blockNumber: 100n
                });

            const result = await service.sync(
                "wallet-1",
                "0xwallet",
                "token-1",
                "0xtoken",
                100n
            );

            expect(publicClient.readContract).toHaveBeenCalledWith({
                address: "0xtoken",
                abi: expect.any(Array),
                functionName: "balanceOf",
                args:[
                    "0xwallet"
                ]
            });

            expect(repositoryMock.upsert).toHaveBeenCalledWith({
                walletId: "wallet-1",
                tokenId: "token-1",
                balance: 5000n,
                blockNumber: 100n
            });

            expect(result).toEqual({
                walletId: "wallet-1",
                tokenId: "token-1",
                balance: 5000n,
                blockNumber: 100n
            });
        }
    );

    it ("should propagate blockchain read failure",
        async () => {
            const error =
                new Error(
                    "RPC unavailable"
                );

            (publicClient.readContract as any)
                .mockRejectedValue(
                    error
                );

            await expect(service.sync(
                "wallet-1",
                "0xwallet",
                "token-1",
                "0xtoken",
                100n
            )).rejects
            .toThrow(
                "RPC unavailable"
            );

            expect(repositoryMock.upsert)
                .not
                .toHaveBeenCalled();
        }
    );
});
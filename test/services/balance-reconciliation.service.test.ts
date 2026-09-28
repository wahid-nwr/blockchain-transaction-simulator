import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BalanceReconciliationService } from '../../src/services/balance-reconciliation.service.js';
import type { BalanceReconciliationRequest } from '../../src/services/balance-reconciliation.service.js';
import type { BalanceRepository } from '../../src/repositories/balance.repository.js';
import type { BlockchainAdapter } from '../../src/blockchain/blockchain-adapter.js';
import { BlockchainAdapterRegistry } from '../../src/blockchain/blockchain-adapter.registry.js';
import {
    ANVIL_CHAIN_ID,
    BITCOIN_REGTEST_CHAIN_ID,
    SOLANA_LOCALNET_CHAIN_ID,
} from '../../src/blockchain/wallet-address.js';

function makeAdapter(chain: string, getTokenBalance?: ReturnType<typeof vi.fn>): BlockchainAdapter {
    return {
        chain,
        submitTransfer: vi.fn(),
        getTransaction: vi.fn(),
        validateAssetIdentifier: () => true,
        ...(getTokenBalance ? { getTokenBalance } : {}),
    } as unknown as BlockchainAdapter;
}

describe('BalanceReconciliationService', () => {
    let service: BalanceReconciliationService;

    const repositoryMock = {
        find: vi.fn(),
        upsert: vi.fn(),
    };

    const evmGetTokenBalance = vi.fn();

    const request: BalanceReconciliationRequest = {
        walletId: 'wallet-1',
        walletAddress: '0xwallet',
        walletChainId: ANVIL_CHAIN_ID,
        tokenId: 'token-1',
        blockchain: 'EVM',
        assetIdentifier: '0xtoken',
        blockNumber: 100n,
    };

    const snapshot = (balance: bigint, blockNumber: bigint) => ({
        walletId: 'wallet-1',
        tokenId: 'token-1',
        balance,
        blockNumber,
    });

    beforeEach(() => {
        vi.clearAllMocks();

        service = new BalanceReconciliationService(
            repositoryMock as unknown as BalanceRepository,
            new BlockchainAdapterRegistry([makeAdapter('EVM', evmGetTokenBalance)]),
        );
    });

    it('should return MATCH when persisted and chain balances agree', async () => {
        repositoryMock.find.mockResolvedValue(snapshot(1000n, 100n));
        evmGetTokenBalance.mockResolvedValue({ balance: 1000n, blockNumber: 100n });

        const result = await service.reconcile(request);

        expect(result).toEqual({
            status: 'MATCH',
            blockchain: 'EVM',
            walletId: 'wallet-1',
            tokenId: 'token-1',
            persisted: { balance: 1000n, blockNumber: 100n },
            chain: { balance: 1000n, blockNumber: 100n },
        });
    });

    it('should read the balance through the adapter for the token blockchain', async () => {
        repositoryMock.find.mockResolvedValue(snapshot(1000n, 100n));
        evmGetTokenBalance.mockResolvedValue({ balance: 1000n, blockNumber: 100n });

        await service.reconcile(request);

        expect(evmGetTokenBalance).toHaveBeenCalledWith({
            walletAddress: '0xwallet',
            assetIdentifier: '0xtoken',
            blockNumber: 100n,
        });
    });

    it('should return MISMATCH when balances differ at the same block', async () => {
        repositoryMock.find.mockResolvedValue(snapshot(1000n, 100n));
        evmGetTokenBalance.mockResolvedValue({ balance: 900n, blockNumber: 100n });

        const result = await service.reconcile(request);

        expect(result.status).toBe('MISMATCH');
        expect(result.persisted).toEqual({ balance: 1000n, blockNumber: 100n });
        expect(result.chain).toEqual({ balance: 900n, blockNumber: 100n });
    });

    it('should return MISMATCH when a newer chain state differs', async () => {
        repositoryMock.find.mockResolvedValue(snapshot(1000n, 100n));
        evmGetTokenBalance.mockResolvedValue({ balance: 900n, blockNumber: 101n });

        const result = await service.reconcile({ ...request, blockNumber: 101n });

        expect(result.status).toBe('MISMATCH');
    });

    it('should return STALE_OBSERVATION when the chain observation is older', async () => {
        repositoryMock.find.mockResolvedValue(snapshot(1000n, 101n));
        evmGetTokenBalance.mockResolvedValue({ balance: 900n, blockNumber: 100n });

        const result = await service.reconcile(request);

        expect(result.status).toBe('STALE_OBSERVATION');
    });

    it('should return MISMATCH when no persisted snapshot exists', async () => {
        repositoryMock.find.mockResolvedValue(null);
        evmGetTokenBalance.mockResolvedValue({ balance: 1000n, blockNumber: 100n });

        const result = await service.reconcile(request);

        expect(result).toEqual({
            status: 'MISMATCH',
            blockchain: 'EVM',
            walletId: 'wallet-1',
            tokenId: 'token-1',
            persisted: null,
            chain: { balance: 1000n, blockNumber: 100n },
        });
    });

    it('should reconcile against the latest chain state when no block is given', async () => {
        repositoryMock.find.mockResolvedValue(snapshot(1000n, 100n));
        evmGetTokenBalance.mockResolvedValue({ balance: 1000n, blockNumber: 120n });

        const result = await service.reconcile({ ...request, blockNumber: undefined });

        expect(evmGetTokenBalance).toHaveBeenCalledWith({
            walletAddress: '0xwallet',
            assetIdentifier: '0xtoken',
            blockNumber: undefined,
        });
        // The position the adapter actually observed is what gets reported.
        expect(result.chain.blockNumber).toBe(120n);
        expect(result.status).toBe('MATCH');
    });

    it('should not modify the persisted snapshot', async () => {
        repositoryMock.find.mockResolvedValue(snapshot(1000n, 100n));
        evmGetTokenBalance.mockResolvedValue({ balance: 900n, blockNumber: 101n });

        await service.reconcile({ ...request, blockNumber: 101n });

        expect(repositoryMock.upsert).not.toHaveBeenCalled();
    });

    it('should propagate a repository failure', async () => {
        repositoryMock.find.mockRejectedValue(new Error('Database unavailable'));

        await expect(service.reconcile(request)).rejects.toThrow('Database unavailable');

        expect(evmGetTokenBalance).not.toHaveBeenCalled();
    });

    it('should propagate a blockchain read failure', async () => {
        repositoryMock.find.mockResolvedValue(snapshot(1000n, 100n));
        evmGetTokenBalance.mockRejectedValue(new Error('RPC unavailable'));

        await expect(service.reconcile(request)).rejects.toThrow('RPC unavailable');
    });

    describe('chain agnosticism', () => {
        it('reconciles a non-EVM chain through its own adapter, with no asset identifier for a native asset', async () => {
            const solanaGetTokenBalance = vi
                .fn()
                .mockResolvedValue({ balance: 5_000_000n, blockNumber: 250_000_000n });

            service = new BalanceReconciliationService(
                repositoryMock as unknown as BalanceRepository,
                new BlockchainAdapterRegistry([
                    makeAdapter('EVM', evmGetTokenBalance),
                    makeAdapter('SOLANA', solanaGetTokenBalance),
                ]),
            );

            repositoryMock.find.mockResolvedValue(snapshot(5_000_000n, 249_999_990n));

            const result = await service.reconcile({
                walletId: 'wallet-1',
                walletAddress: 'So11111111111111111111111111111111111111112',
                walletChainId: SOLANA_LOCALNET_CHAIN_ID,
                tokenId: 'token-1',
                blockchain: 'SOLANA',
            });

            expect(solanaGetTokenBalance).toHaveBeenCalledWith({
                walletAddress: 'So11111111111111111111111111111111111111112',
                assetIdentifier: undefined,
                blockNumber: undefined,
            });
            expect(evmGetTokenBalance).not.toHaveBeenCalled();
            expect(result.status).toBe('MATCH');
            expect(result.blockchain).toBe('SOLANA');
        });

        it('reconciles a Bitcoin native balance through the Bitcoin adapter capability', async () => {
            const bitcoinGetTokenBalance = vi
                .fn()
                .mockResolvedValue({ balance: 125_000_000n, blockNumber: 250n });

            service = new BalanceReconciliationService(
                repositoryMock as unknown as BalanceRepository,
                new BlockchainAdapterRegistry([makeAdapter('BITCOIN', bitcoinGetTokenBalance)]),
            );

            repositoryMock.find.mockResolvedValue(snapshot(125_000_000n, 249n));

            const result = await service.reconcile({
                walletId: 'wallet-1',
                walletAddress: 'bcrt1qwallet',
                walletChainId: BITCOIN_REGTEST_CHAIN_ID,
                tokenId: 'token-1',
                blockchain: 'BITCOIN',
            });

            expect(bitcoinGetTokenBalance).toHaveBeenCalledWith({
                walletAddress: 'bcrt1qwallet',
                assetIdentifier: undefined,
                blockNumber: undefined,
            });
            expect(result.status).toBe('MATCH');
            expect(result.blockchain).toBe('BITCOIN');
            expect(result.chain).toEqual({ balance: 125_000_000n, blockNumber: 250n });
        });

        it('rejects a chain whose adapter has no balance-read capability', async () => {
            service = new BalanceReconciliationService(
                repositoryMock as unknown as BalanceRepository,
                new BlockchainAdapterRegistry([makeAdapter('BITCOIN')]),
            );

            await expect(
                service.reconcile({
                    ...request,
                    walletChainId: BITCOIN_REGTEST_CHAIN_ID,
                    blockchain: 'BITCOIN',
                }),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'UNSUPPORTED_CHAIN_CAPABILITY',
            });

            expect(repositoryMock.find).not.toHaveBeenCalled();
        });

        it('rejects a wallet that is not on the token chain before any read happens', async () => {
            await expect(
                service.reconcile({ ...request, walletChainId: BITCOIN_REGTEST_CHAIN_ID }),
            ).rejects.toMatchObject({
                statusCode: 400,
                code: 'WALLET_TOKEN_CHAIN_MISMATCH',
            });

            expect(repositoryMock.find).not.toHaveBeenCalled();
            expect(evmGetTokenBalance).not.toHaveBeenCalled();
        });

        it('rejects a wallet with an unrecognized chainId', async () => {
            await expect(
                service.reconcile({ ...request, walletChainId: 424242 }),
            ).rejects.toMatchObject({ code: 'WALLET_TOKEN_CHAIN_MISMATCH' });
        });
    });
});

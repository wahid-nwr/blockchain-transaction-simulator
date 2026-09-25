import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TokenService } from '../../src/services/token.service.js';
import { TokenRepository } from '../../src/repositories/token.repository.js';
import type { BlockchainAdapterRegistry } from '../../src/blockchain/blockchain-adapter.registry.js';

describe('TokenService', () => {
    const repositoryMock = {
        exists: vi.fn(),
        create: vi.fn(),
        findById: vi.fn(),
        findAll: vi.fn(),
    };

    const evmAdapterMock = {
        chain: 'EVM',
        validateAssetIdentifier: vi.fn(),
        mint: vi.fn(),
    };

    const registryMock = {
        get: vi.fn(),
    };

    let service: TokenService;

    beforeEach(() => {
        vi.clearAllMocks();
        registryMock.get.mockReturnValue(evmAdapterMock);
        evmAdapterMock.validateAssetIdentifier.mockReturnValue(true);
        service = new TokenService(
            repositoryMock as unknown as TokenRepository,
            registryMock as unknown as BlockchainAdapterRegistry,
        );
    });

    it('should register token when token does not exist', async () => {
        repositoryMock.exists.mockResolvedValue(false);

        repositoryMock.create.mockResolvedValue({
            id: 'token-1',
            symbol: 'USDT',
        });

        const result = await service.registerToken({
            name: 'Mini USDT',
            symbol: 'USDT',
            contractAddress: '0x123',
            decimals: 6,
            blockchain: 'EVM',
        });

        expect(registryMock.get).toHaveBeenCalledWith('EVM');
        expect(evmAdapterMock.validateAssetIdentifier).toHaveBeenCalledWith('0x123');

        expect(repositoryMock.exists).toHaveBeenCalledWith('0x123', 'EVM');

        expect(repositoryMock.create).toHaveBeenCalledWith({
            name: 'Mini USDT',
            symbol: 'USDT',
            contractAddress: '0x123',
            decimals: 6,
            blockchain: 'EVM',
        });

        expect(result).toEqual({
            id: 'token-1',
            symbol: 'USDT',
        });
    });

    it('should reject a malformed asset identifier before touching the repository', async () => {
        evmAdapterMock.validateAssetIdentifier.mockReturnValue(false);

        await expect(
            service.registerToken({
                name: 'Mini USDT',
                symbol: 'USDT',
                contractAddress: 'not-an-address',
                decimals: 6,
                blockchain: 'EVM',
            }),
        ).rejects.toThrow("'not-an-address' is not a valid asset identifier for EVM");

        expect(repositoryMock.exists).not.toHaveBeenCalled();
        expect(repositoryMock.create).not.toHaveBeenCalled();
    });

    it('should reject duplicate token', async () => {
        repositoryMock.exists.mockResolvedValue(true);

        await expect(
            service.registerToken({
                name: 'Mini USDT',
                symbol: 'USDT',
                contractAddress: '0x123',
                decimals: 6,
                blockchain: 'EVM',
            }),
        ).rejects.toThrow('Token already registered');

        expect(repositoryMock.create).not.toHaveBeenCalled();
    });

    it('should get token by id', async () => {
        repositoryMock.findById.mockResolvedValue({
            id: 'token-1',
            symbol: 'USDT',
        });

        const result = await service.getToken('token-1');

        expect(repositoryMock.findById).toHaveBeenCalledWith('token-1');

        expect(result).toEqual({
            id: 'token-1',
            symbol: 'USDT',
        });
    });

    it('should throw error when token is missing', async () => {
        repositoryMock.findById.mockResolvedValue(null);

        await expect(service.getToken('missing')).rejects.toThrow('Token not found');
    });

    it('should dispatch mint request to the resolved chain adapter', async () => {
        repositoryMock.findById.mockResolvedValue({
            id: 'token-1',
            contractAddress: '0xtoken',
            blockchain: 'EVM',
        });

        evmAdapterMock.mint.mockResolvedValue({
            txHash: '0xhash',
        });

        const result = await service.mintToken('token-1', '0xreceiver', 1000n);

        expect(repositoryMock.findById).toHaveBeenCalledWith('token-1');
        expect(registryMock.get).toHaveBeenCalledWith('EVM');

        expect(evmAdapterMock.mint).toHaveBeenCalledWith({
            assetIdentifier: '0xtoken',
            toAddress: '0xreceiver',
            amount: 1000n,
        });

        expect(result).toEqual({
            transactionHash: '0xhash',
        });
    });

    it('should reject minting on a chain whose adapter has no mint capability', async () => {
        repositoryMock.findById.mockResolvedValue({
            id: 'token-1',
            contractAddress: null,
            blockchain: 'BITCOIN',
        });

        registryMock.get.mockReturnValue({
            chain: 'BITCOIN',
            validateAssetIdentifier: vi.fn().mockReturnValue(false),
            // no `mint` — Bitcoin has no mint-capable token layer
        });

        await expect(service.mintToken('token-1', 'bcrt1qreceiver', 1000n)).rejects.toThrow(
            'BITCOIN does not support mint',
        );
    });
});

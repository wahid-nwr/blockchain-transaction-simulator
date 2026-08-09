import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TokenService } from '../../src/services/token.service.js';
import { TokenRepository } from '../../src/repositories/token.repository.js';
import { MintService } from '../../src/services/mint.service.js';

describe('TokenService', () => {
    const repositoryMock = {
        exists: vi.fn(),
        create: vi.fn(),
        findById: vi.fn(),
        findAll: vi.fn(),
    };

    const mintServiceMock = {
        mint: vi.fn(),
    };

    let service: TokenService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TokenService(
            repositoryMock as unknown as TokenRepository,
            mintServiceMock as unknown as MintService,
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
        });

        expect(repositoryMock.exists).toHaveBeenCalledWith('0x123');

        expect(repositoryMock.create).toHaveBeenCalledWith({
            name: 'Mini USDT',
            symbol: 'USDT',
            contractAddress: '0x123',
            decimals: 6,
        });

        expect(result).toEqual({
            id: 'token-1',
            symbol: 'USDT',
        });
    });

    it('should reject duplicate token', async () => {
        repositoryMock.exists.mockResolvedValue(true);

        await expect(
            service.registerToken({
                name: 'Mini USDT',
                symbol: 'USDT',
                contractAddress: '0x123',
                decimals: 6,
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

    it('should delegate mint request to MintService', async () => {
        repositoryMock.findById.mockResolvedValue({
            id: 'token-1',
            contractAddress: '0xtoken',
        });

        mintServiceMock.mint.mockResolvedValue({
            transactionHash: '0xhash',
        });

        const result = await service.mintToken('token-1', '0xreceiver', 1000n);

        expect(repositoryMock.findById).toHaveBeenCalledWith('token-1');

        expect(mintServiceMock.mint).toHaveBeenCalledWith('0xtoken', '0xreceiver', 1000n);

        expect(result).toEqual({
            transactionHash: '0xhash',
        });
    });
});

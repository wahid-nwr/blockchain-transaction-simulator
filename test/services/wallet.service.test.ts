import { describe, it, expect, vi, beforeEach } from 'vitest';

const repositoryMock = {
    create: vi.fn(),

    findByAddress: vi.fn(),

    findById: vi.fn(),

    findByOwnerId: vi.fn(),
};

vi.mock('../../src/repositories/wallet.repository.js', () => ({
    WalletRepository: vi.fn(() => repositoryMock),
}));

import { WalletService } from '../../src/services/wallet.service.js';

import { Role } from '@prisma/client';

describe('WalletService', () => {
    let service: WalletService;

    beforeEach(() => {
        vi.clearAllMocks();

        service = new WalletService();
    });

    it('should create wallet successfully', async () => {
        const address = '0x12b2d2f7ba4020e4f6d4e08ea0aef4c873d87708';

        repositoryMock.findByAddress.mockResolvedValue(null);

        repositoryMock.create.mockResolvedValue({
            id: 'wallet-1',

            address,

            status: 'ACTIVE',
        });

        const result = await service.createWallet({
            tenantId: 'tenant-1',

            ownerId: 'user-1',

            chainId: 31337,

            address,
        });

        expect(repositoryMock.findByAddress).toHaveBeenCalledWith(address);

        expect(repositoryMock.create).toHaveBeenCalled();

        expect(result.id).toBe('wallet-1');
    });

    it('should reject invalid wallet address', async () => {
        await expect(
            service.createWallet({
                tenantId: 'tenant-1',

                ownerId: 'user-1',

                chainId: 31337,

                address: 'invalid',
            }),
        ).rejects.toThrow('Invalid wallet address');
    });

    it('should reject duplicate wallet', async () => {
        repositoryMock.findByAddress.mockResolvedValue({
            id: 'existing',
        });

        await expect(
            service.createWallet({
                tenantId: 'tenant-1',

                ownerId: 'user-1',

                chainId: 31337,

                address: '0x12b2d2f7ba4020e4f6d4e08ea0aef4c873d87708',
            }),
        ).rejects.toThrow('Wallet already registered');
    });

    it('should get wallet for owner', async () => {
        repositoryMock.findById.mockResolvedValue({
            id: 'wallet-1',

            tenantId: 'tenant-1',

            ownerId: 'user-1',
        });

        const result = await service.getWallet(
            'wallet-1',

            'user-1',

            'tenant-1',

            Role.USER,
        );

        expect(result.id).toBe('wallet-1');
    });

    it('should reject missing wallet', async () => {
        repositoryMock.findById.mockResolvedValue(null);

        await expect(
            service.getWallet(
                'missing',

                'user-1',

                'tenant-1',

                Role.USER,
            ),
        ).rejects.toThrow('Wallet not found');
    });

    it('should allow admin access', async () => {
        repositoryMock.findById.mockResolvedValue({
            id: 'wallet-1',

            tenantId: 'tenant-1',

            ownerId: 'another-user',
        });

        const result = await service.getWallet(
            'wallet-1',

            'admin',

            'tenant-1',

            Role.ADMIN,
        );

        expect(result.id).toBe('wallet-1');
    });
});

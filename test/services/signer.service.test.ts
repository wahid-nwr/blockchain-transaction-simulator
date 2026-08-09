import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SignerService } from '../../src/services/signer.service.js';
import * as envelope from '../../src/crypto/envelope.js';
import * as client from '../../src/blockchain/client.js';

vi.mock('../../src/crypto/envelope.js', () => ({
    decryptWalletKey: vi.fn(),
    encryptWalletKey: vi.fn(),
}));

vi.mock('../../src/blockchain/client.js', () => ({
    getWalletClient: vi.fn(),
}));

describe('SignerService', () => {
    const walletRepositoryMock = {
        findByIdForTenantWithCustody: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws WALLET_NOT_FOUND when the wallet does not belong to the tenant', async () => {
        walletRepositoryMock.findByIdForTenantWithCustody.mockResolvedValue(null);

        const service = new SignerService(walletRepositoryMock as any);

        await expect(service.getWalletClientFor('wallet-1', 'tenant-1')).rejects.toMatchObject({
            code: 'WALLET_NOT_FOUND',
        });

        expect(envelope.decryptWalletKey).not.toHaveBeenCalled();
    });

    it('throws WALLET_NOT_CUSTODIAL for an EXTERNAL wallet, even without decrypting anything', async () => {
        walletRepositoryMock.findByIdForTenantWithCustody.mockResolvedValue({
            id: 'wallet-1',
            custodyType: 'EXTERNAL',
            custodyKey: null,
        });

        const service = new SignerService(walletRepositoryMock as any);

        await expect(service.getWalletClientFor('wallet-1', 'tenant-1')).rejects.toMatchObject({
            code: 'WALLET_NOT_CUSTODIAL',
        });

        expect(envelope.decryptWalletKey).not.toHaveBeenCalled();
    });

    it('throws WALLET_NOT_CUSTODIAL if marked CUSTODIAL but has no key row (data inconsistency)', async () => {
        walletRepositoryMock.findByIdForTenantWithCustody.mockResolvedValue({
            id: 'wallet-1',
            custodyType: 'CUSTODIAL',
            custodyKey: null,
        });

        const service = new SignerService(walletRepositoryMock as any);

        await expect(service.getWalletClientFor('wallet-1', 'tenant-1')).rejects.toMatchObject({
            code: 'WALLET_NOT_CUSTODIAL',
        });
    });

    it('decrypts the key and builds a wallet client for a valid custodial wallet', async () => {
        walletRepositoryMock.findByIdForTenantWithCustody.mockResolvedValue({
            id: 'wallet-1',
            custodyType: 'CUSTODIAL',
            custodyKey: {
                encryptedKey: new Uint8Array([1, 2, 3]),
                kmsKeyId: 'test-key',
            },
        });

        vi.mocked(envelope.decryptWalletKey).mockResolvedValue(
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        );

        const walletClientStub = { writeContract: vi.fn() };
        vi.mocked(client.getWalletClient).mockReturnValue(walletClientStub as any);

        const service = new SignerService(walletRepositoryMock as any);
        const result = await service.getWalletClientFor('wallet-1', 'tenant-1');

        expect(envelope.decryptWalletKey).toHaveBeenCalledWith(
            new Uint8Array([1, 2, 3]),
            'test-key',
        );
        expect(client.getWalletClient).toHaveBeenCalledWith(
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        );
        expect(result).toBe(walletClientStub);
    });
});

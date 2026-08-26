import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiKeyService } from '../../src/auth/api-key.service.js';
import { hashToken } from '../../src/utils/crypto.hash.js';

vi.mock('../../src/services/audit-log.service.js', () => ({
    auditLogService: {
        record: vi.fn(),
    },
}));

import { auditLogService } from '../../src/services/audit-log.service.js';

describe('ApiKeyService', () => {
    const repository = {
        create: vi.fn(),
        findActiveByPrefix: vi.fn(),
        touchLastUsed: vi.fn(),
        listByTenant: vi.fn(),
        findByIdForTenant: vi.fn(),
        revoke: vi.fn(),
    } as any;

    let service: ApiKeyService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ApiKeyService(repository);
    });

    describe('createKey', () => {
        it('generates a raw key, hashes it, and stores the hash (never the raw key)', async () => {
            repository.create.mockImplementation(async (data: any) => ({
                id: 'key-1',
                ...data,
            }));

            const result = await service.createKey('tenant-1', { name: 'CI key' });

            expect(repository.create).toHaveBeenCalledTimes(1);
            const stored = repository.create.mock.calls[0][0];

            expect(stored.tenantId).toBe('tenant-1');
            expect(stored.keyHash).toBe(hashToken(result.apiKey));
            expect(stored.keyPrefix).toBe(result.apiKey.substring(0, 8));
            expect(stored.scopes).toEqual(['*']);

            expect(result.apiKey).toMatch(/^tenant_[a-f0-9]{64}$/);
        });

        it('defaults scopes to a wildcard when none are given, and passes through explicit scopes', async () => {
            repository.create.mockImplementation(async (data: any) => ({
                id: 'key-1',
                ...data,
            }));

            await service.createKey('tenant-1', { name: 'scoped', scopes: ['transactions:read'] });

            expect(repository.create.mock.calls[0][0].scopes).toEqual(['transactions:read']);
        });

        it('records an audit log entry', async () => {
            repository.create.mockResolvedValue({
                id: 'key-1',
                name: 'CI key',
                scopes: ['*'],
                keyPrefix: 'tenant_a',
                expiresAt: null,
                createdAt: new Date(),
            });

            await service.createKey('tenant-1', { name: 'CI key' });

            expect(auditLogService.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    tenantId: 'tenant-1',
                    action: 'api_key.created',
                    resource: 'ApiKey',
                    resourceId: 'key-1',
                }),
            );
        });
    });

    describe('verifyKey', () => {
        it('resolves the tenant for a matching, active key', async () => {
            const rawKey = 'tenant_deadbeef1234';
            const keyHash = hashToken(rawKey);

            repository.findActiveByPrefix.mockResolvedValue([
                {
                    id: 'key-1',
                    keyHash,
                    tenant: { id: 'tenant-1', name: 'Acme' },
                },
            ]);

            const result = await service.verifyKey(rawKey);

            expect(repository.findActiveByPrefix).toHaveBeenCalledWith(rawKey.substring(0, 8));
            expect(result.tenant.id).toBe('tenant-1');
            expect(repository.touchLastUsed).toHaveBeenCalledWith('key-1');
        });

        it('rejects when no candidate hash matches (wrong key)', async () => {
            repository.findActiveByPrefix.mockResolvedValue([
                {
                    id: 'key-1',
                    keyHash: hashToken('tenant_someotherkey'),
                    tenant: { id: 'tenant-1' },
                },
            ]);

            await expect(service.verifyKey('tenant_wrongkeyvalue')).rejects.toThrow(
                'Invalid tenant API key',
            );

            expect(repository.touchLastUsed).not.toHaveBeenCalled();
        });

        it('rejects when there are no active candidates (expired/revoked)', async () => {
            repository.findActiveByPrefix.mockResolvedValue([]);

            await expect(service.verifyKey('tenant_deadbeef1234')).rejects.toThrow(
                'Invalid tenant API key',
            );
        });

        it('rejects keys shorter than the prefix length without querying the repository', async () => {
            await expect(service.verifyKey('short')).rejects.toThrow('Invalid tenant API key');
            expect(repository.findActiveByPrefix).not.toHaveBeenCalled();
        });
    });

    describe('revokeKey', () => {
        it('revokes an existing key and records an audit entry', async () => {
            repository.findByIdForTenant.mockResolvedValue({ id: 'key-1' });
            repository.revoke.mockResolvedValue(true);

            const result = await service.revokeKey('tenant-1', 'key-1');

            expect(result).toEqual({ id: 'key-1', revoked: true });
            expect(auditLogService.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    tenantId: 'tenant-1',
                    action: 'api_key.revoked',
                    resourceId: 'key-1',
                }),
            );
        });

        it('throws 404 when the key does not belong to the tenant', async () => {
            repository.findByIdForTenant.mockResolvedValue(null);

            await expect(service.revokeKey('tenant-1', 'nope')).rejects.toThrow(
                'API key not found',
            );
            expect(repository.revoke).not.toHaveBeenCalled();
        });

        it('throws 409 when the key was already revoked', async () => {
            repository.findByIdForTenant.mockResolvedValue({ id: 'key-1' });
            repository.revoke.mockResolvedValue(false);

            await expect(service.revokeKey('tenant-1', 'key-1')).rejects.toThrow(
                'API key already revoked',
            );
        });
    });
});

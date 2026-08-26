import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiKeyRepository } from '../repositories/api-key.repository.js';
import { hashToken } from '../utils/crypto.hash.js';
import { AppError } from '../common/errors/app.error.js';
import { auditLogService } from '../services/audit-log.service.js';

const KEY_PREFIX_LENGTH = 8;

export interface CreateApiKeyInput {
    name: string;
    scopes?: string[];
    expiresAt?: Date | null;
}

export class ApiKeyService {
    constructor(private readonly repository: ApiKeyRepository) {}

    /**
     * Generates the raw, presented-once key. Format matches the existing
     * `tenant_<64 hex>` convention so already-issued keys keep working.
     */
    private generateRawKey(): string {
        return `tenant_${randomBytes(32).toString('hex')}`;
    }

    async createKey(tenantId: string, input: CreateApiKeyInput) {
        const rawKey = this.generateRawKey();
        const keyHash = hashToken(rawKey);
        const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH);

        const record = await this.repository.create({
            tenantId,
            keyHash,
            keyPrefix,
            name: input.name,
            scopes: input.scopes && input.scopes.length > 0 ? input.scopes : ['*'],
            expiresAt: input.expiresAt ?? null,
        });

        await auditLogService.record({
            tenantId,
            action: 'api_key.created',
            resource: 'ApiKey',
            resourceId: record.id,
            metadata: { name: record.name, scopes: record.scopes },
        });

        return {
            id: record.id,
            apiKey: rawKey,
            keyPrefix: record.keyPrefix,
            name: record.name,
            scopes: record.scopes,
            expiresAt: record.expiresAt,
            createdAt: record.createdAt,
        };
    }

    /**
     * Verifies a raw presented key and returns its tenant.
     *
     * Lookup is by prefix (indexed, not secret on its own) to narrow to a
     * small candidate set, then each candidate's stored hash is compared
     * to the presented key's hash with a constant-time comparison so the
     * check doesn't leak timing information about which hash byte differs.
     */
    async verifyKey(rawKey: string) {
        if (!rawKey || rawKey.length < KEY_PREFIX_LENGTH) {
            throw new AppError(401, 'INVALID_TENANT_KEY', 'Invalid tenant API key');
        }

        const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH);
        const presentedHash = Buffer.from(hashToken(rawKey), 'hex');

        const candidates = await this.repository.findActiveByPrefix(keyPrefix);

        const match = candidates.find((candidate) => {
            const storedHash = Buffer.from(candidate.keyHash, 'hex');
            return (
                storedHash.length === presentedHash.length &&
                timingSafeEqual(storedHash, presentedHash)
            );
        });

        if (!match) {
            throw new AppError(401, 'INVALID_TENANT_KEY', 'Invalid tenant API key');
        }

        await this.repository.touchLastUsed(match.id);

        return { tenant: match.tenant, apiKey: match };
    }

    async listKeys(tenantId: string) {
        const keys = await this.repository.listByTenant(tenantId);

        return keys.map((key) => ({
            id: key.id,
            keyPrefix: key.keyPrefix,
            name: key.name,
            scopes: key.scopes,
            active: key.active,
            lastUsedAt: key.lastUsedAt,
            expiresAt: key.expiresAt,
            createdAt: key.createdAt,
            revokedAt: key.revokedAt,
        }));
    }

    async revokeKey(tenantId: string, keyId: string) {
        const existing = await this.repository.findByIdForTenant(tenantId, keyId);

        if (!existing) {
            throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found');
        }

        const revoked = await this.repository.revoke(tenantId, keyId);

        if (!revoked) {
            throw new AppError(409, 'API_KEY_ALREADY_REVOKED', 'API key already revoked');
        }

        await auditLogService.record({
            tenantId,
            action: 'api_key.revoked',
            resource: 'ApiKey',
            resourceId: keyId,
        });

        return { id: keyId, revoked: true };
    }
}

import { AppError } from './app.error.js';

export const Errors = {
    unauthorized(message = 'Unauthorized') {
        return new AppError(401, 'UNAUTHORIZED', message);
    },

    invalidCredentials(message = 'Unauthorized') {
        return new AppError(401, 'INVALID_CREDENTIALS', message);
    },

    forbidden(message = 'Forbidden') {
        return new AppError(403, 'FORBIDDEN', message);
    },

    invalidToken(message = 'Invalid authentication token') {
        return new AppError(401, 'FORBIDDEN', message);
    },

    invalidSigner(message = 'Invalid signer') {
        return new AppError(403, 'FORBIDDEN', message);
    },

    validation(details?: unknown) {
        return new AppError(400, 'VALIDATION_ERROR', 'Validation failed', details);
    },

    resourceNotFound(resource: string, id?: string) {
        return new AppError(
            404,
            `${resource.toUpperCase()}_NOT_FOUND`,
            `${resource} not found`,
            id ? { id } : undefined,
        );
    },

    walletNotFound(walletId?: string) {
        return new AppError(
            404,
            'WALLET_NOT_FOUND',
            'Wallet not found',
            walletId ? { walletId } : undefined,
        );
    },

    tokenNotFound(tokenId?: string) {
        return new AppError(
            404,
            'TOKEN_NOT_FOUND',
            'Token not found',
            tokenId ? { tokenId } : undefined,
        );
    },

    transactionNotFound(transactionId?: string) {
        return new AppError(
            404,
            'TRANSACTION_NOT_FOUND',
            'Transaction not found',
            transactionId ? { transactionId } : undefined,
        );
    },

    tenantNotFound(tenantId?: string) {
        return new AppError(
            404,
            'TENANT_NOT_FOUND',
            'Tenant not found',
            tenantId ? { tenantId } : undefined,
        );
    },

    duplicate(resource: string, details?: unknown) {
        return new AppError(409, 'RESOURCE_ALREADY_EXISTS', `${resource} already exists`, details);
    },

    invalidReference(details?: unknown) {
        return new AppError(400, 'INVALID_REFERENCE', 'Invalid resource reference', details);
    },

    blockchainError(message = 'Blockchain operation failed', details?: unknown) {
        return new AppError(502, 'BLOCKCHAIN_ERROR', message, details);
    },

    internal(message = 'Internal server error') {
        return new AppError(500, 'INTERNAL_ERROR', message);
    },
};

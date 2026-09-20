import { prisma } from '../database/prisma.js';
import {
    isCaseInsensitiveWalletAddress,
    normalizeWalletAddress,
} from '../blockchain/wallet-address.js';

export class WalletRepository {
    create(data: { tenantId: string; ownerId: string; chainId: number; address: string }) {
        return prisma.wallet.create({
            data: {
                tenantId: data.tenantId,
                ownerId: data.ownerId,
                chainId: data.chainId,
                address: normalizeWalletAddress(data.chainId, data.address),
            },
        });
    }

    findByIdForTenant(id: string, tenantId: string) {
        return prisma.wallet.findFirst({
            where: { id, tenantId },
        });
    }

    // Only the signing path should call this — it's the sole method that can
    // return key-custody material (still encrypted at rest, but still).
    findByIdForTenantWithCustody(id: string, tenantId: string) {
        return prisma.wallet.findFirst({
            where: { id, tenantId },
            include: { custodyKey: true },
        });
    }

    findByOwnerId(ownerId: string) {
        return prisma.wallet.findMany({
            where: {
                ownerId,
            },
        });
    }

    findById(id: string) {
        return prisma.wallet.findUnique({
            where: {
                id,
            },
        });
    }

    // chainId is required (not optional) specifically so a caller can't
    // accidentally get the old, chain-blind, always-case-insensitive
    // lookup back by omitting it — see isCaseInsensitiveWalletAddress and
    // ADR-011 for why that was a real bug for base58 addresses (Bitcoin
    // legacy and Solana).
    findByAddress(chainId: number, address: string) {
        if (isCaseInsensitiveWalletAddress(chainId, address)) {
            return prisma.wallet.findFirst({
                where: {
                    address: {
                        equals: address,
                        mode: 'insensitive',
                    },
                },
            });
        }

        return prisma.wallet.findFirst({
            where: { address },
        });
    }
}

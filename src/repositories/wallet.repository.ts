import { CustodyType } from '@prisma/client';
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

    // Wallet and its custody key are written in ONE nested create, i.e. one
    // transaction: a custodial wallet can never exist without its key, or the
    // other way round. No `include`, so the returned row (and therefore any
    // API response built from it) carries no key material.
    createCustodial(data: {
        tenantId: string;
        ownerId: string;
        chainId: number;
        address: string;
        encryptedKey: Uint8Array<ArrayBuffer>;
        kmsKeyId: string;
    }) {
        return prisma.wallet.create({
            data: {
                tenantId: data.tenantId,
                ownerId: data.ownerId,
                chainId: data.chainId,
                address: normalizeWalletAddress(data.chainId, data.address),
                custodyType: CustodyType.CUSTODIAL,
                custodyKey: {
                    create: {
                        encryptedKey: data.encryptedKey,
                        kmsKeyId: data.kmsKeyId,
                    },
                },
            },
        });
    }

    // Existence only (`select: { id }`): lets callers ask "does a signing key
    // exist?" without ever loading ciphertext — unlike
    // findByIdForTenantWithCustody, which is reserved for the signing path.
    findCustodyStatusById(id: string) {
        return prisma.wallet.findUnique({
            where: { id },
            select: {
                custodyType: true,
                custodyKey: { select: { id: true } },
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

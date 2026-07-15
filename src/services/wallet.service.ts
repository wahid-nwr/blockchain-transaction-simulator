import { WalletRepository } from "../repositories/wallet.repository.js";
import { isAddress } from "viem";
import { Role } from "@prisma/client";
import { AppError } from "../common/errors/app.error.js";

export class WalletService {
    private readonly repository: WalletRepository;

    constructor() {
        this.repository = new WalletRepository();
    }

    async createWallet(data: {
        tenantId: string;
        ownerId: string;
        chainId: number;
        address: string;
    }) {
        if (!isAddress(data.address)) {
            throw new AppError(
                400,
                "INVALID_WALLET_ADDRESS",
                "Invalid wallet address"
            );
        }

        const existing = await this.repository.findByAddress(
            data.address
        );
        if (existing) {
            throw new AppError(
                409,
                "WALLET_ALREADY_EXISTS",
                "Wallet already registered"
            );
        }
        return this.repository.create(data);
    }

    async getUserWallets(userId: string) {
        return this.repository.findByOwnerId(userId);
    }

    async getWallet(
        id: string,
        userId: string,
        tenantId: string,
        role: Role
    ) {
        const wallet = await this.repository.findById(id);
        if (!wallet) {
            throw new AppError(
                404,
                "WALLET_NOT_FOUND",
                "Wallet not found"
            );
        }

        if (
            wallet.tenantId !== tenantId ||
            (
                wallet.ownerId !== userId &&
                role !== Role.ADMIN
            )
        ) {
            throw new AppError(
                403,
                "FORBIDDEN",
                "You do not have access to this wallet"
            );
        }
        return wallet;
    }
}
import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { Role } from "@prisma/client";

import { TransactionRepository } from "../../repositories/transaction.repository.js";
import { LedgerService } from "../../services/ledger.service.js";
import { TransferService } from "../../services/transfer.service.js";
import { WalletService } from "../../services/wallet.service.js";
import { serializeBigInt } from "../../utils/serialize.js";

const transactionRepository = new TransactionRepository();
const ledgerService = new LedgerService(
    transactionRepository
);
const transferService = new TransferService(
    ledgerService
);
const walletService = new WalletService();

export default async function transactionRoutes(
    app: FastifyInstance
) {
    app.post(
        "/",
        {
            preHandler:[
                authenticate,
                authorize([
                    Role.USER,
                    Role.ADMIN
                ])
            ]
        },
        async (request, reply) => {
            const body = request.body as {
                tokenId:string;
                toWalletId:string;
                amount:string;
                to:string;
            };

            const wallets = await walletService.getUserWallets(
                request.user.id
            );

            if (wallets.length === 0){
                throw new Error(
                    "No wallet found"
                );
            }

            const wallet = wallets[0];
            const transaction = await transferService.transfer({
                tenantId: request.user.tenantId,
                tokenId: body.tokenId,
                fromWalletId: wallet.id,
                toWalletId: body.toWalletId,
                amount: BigInt(body.amount),
                account: wallet.address,
                to: body.to
            });

            return reply.code(201).send({
                data: serializeBigInt(transaction),
                requestId: request.id
            });
        }
    );
}
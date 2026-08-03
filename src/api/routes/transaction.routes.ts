import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { Role } from '@prisma/client';
import { TokenRepository } from '../../repositories/token.repository.js';
import { TransactionRepository } from '../../repositories/transaction.repository.js';
import { TokenService } from '../../services/token.service.js';
import { LedgerService } from '../../services/ledger.service.js';
import { WalletService } from '../../services/wallet.service.js';
import { MintService } from '../../services/mint.service.js';
import { TransferService } from '../../services/transfer.service.js';
import { serializeBigInt } from '../../utils/serialize.js';
import { TransactionService } from '../../services/transaction.service.js';
import { TransferRequest, transferSchema, transactionIdSchema } from '../../validators/transaction.validator.js';

const transactionRepository = new TransactionRepository();
const ledgerService = new LedgerService(transactionRepository);
const transactionService = new TransactionService(transactionRepository);
const tokenService = new TokenService(new TokenRepository(), new MintService());
const transferService = new TransferService(ledgerService, new WalletService(), tokenService);

export default async function transactionRoutes(app: FastifyInstance) {
    app.post<{
        Body: TransferRequest;
    }>(
        '/',
        {
            preHandler: [authenticate, authorize([Role.USER, Role.ADMIN])],
        },
        async (request, reply) => {
            const body = transferSchema.parse(request.body);

            const transaction = await transferService.transfer({
                tenantId: request.user.tenantId,
                userId: request.user.id,
                tokenId: body.tokenId,
                toWalletId: body.toWalletId,
                amount: body.amount,
                signer: body.signer,
            });

            return reply.code(201).send({
                data: serializeBigInt(transaction),
                requestId: request.id,
            });
        },
    );

    app.get(
        '/',
        {
            preHandler: [authenticate, authorize([Role.USER, Role.ADMIN])],
        },
        async (request, reply) => {
            const query = request.query as {
                page?: string;
                limit?: string;
            };
            const transactions = await transactionService.list(
                request.user.tenantId,
                Number(query.page ?? 1),
                Number(query.limit ?? 20),
            );

            return reply.send({
                data: serializeBigInt(transactions),
                requestId: request.id,
            });
        },
    );

    app.get(
        '/:id',
        {
            preHandler: [authenticate, authorize([Role.USER, Role.ADMIN])],
        },
        async (request, reply) => {
            const params =  transactionIdSchema.parse(request.params);
            const transaction = await transactionService.getById(params.id, request.user.tenantId);
            if (!transaction) {
                return reply.code(404).send({
                    error: {
                        code: 'NOT_FOUND',
                        message: 'Transaction not found',
                    },
                    requestId: request.id,
                });
            }

            return reply.send({
                data: serializeBigInt(transaction),
                requestId: request.id,
            });
        },
    );
}

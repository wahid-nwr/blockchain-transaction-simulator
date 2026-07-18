import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { createWalletSchema, walletParamsSchema } from '../../validators/wallet.validator.js';
import { successResponse } from '../utils/response.js';
import { WalletService } from '../../services/wallet.service.js';
import { BalanceRepository } from '../../repositories/balance.repository.js';
import { BalanceService } from '../../services/balance.service.js';

const walletService = new WalletService();
const balanceService = new BalanceService(new BalanceRepository());

export default async function walletRoutes(app: FastifyInstance) {
    /**
     * Existing identity endpoint
     */
    app.get(
        '/me',
        {
            preHandler: [authenticate, authorize([Role.USER, Role.ADMIN])],
        },
        async (request, reply) => {
            return successResponse(reply, {
                userId: request.user.id,
                email: request.user.email,
                role: request.user.role,
                tenantId: request.user.tenantId,
            });
        },
    );

    /**
     * Get current user's wallets
     */
    app.get(
        '/',
        {
            preHandler: [authenticate, authorize([Role.USER, Role.ADMIN])],
        },
        async (request, reply) => {
            const wallets = await walletService.getUserWallets(request.user.id);

            return successResponse(reply, wallets);
        },
    );

    /**
     * Get wallet by id
     */
    app.get(
        '/:id',
        {
            preHandler: [authenticate, authorize([Role.USER, Role.ADMIN])],
        },
        async (request, reply) => {
            const { id } = walletParamsSchema.parse(request.params);

            const wallet = await walletService.getWallet(
                id,
                request.user.id,
                request.user.tenantId,
                request.user.role,
            );

            return successResponse(reply, wallet);
        },
    );

    /**
     * Register wallet
     */
    app.post(
        '/',
        {
            schema: {
                body: createWalletSchema,
            },
            preHandler: [authenticate, authorize([Role.USER, Role.ADMIN])],
        },
        async (request, reply) => {
            const body = createWalletSchema.parse(request.body);
            const wallet = await walletService.createWallet({
                ...body,
                tenantId: request.user.tenantId,
                ownerId: request.user.id,
            });

            return successResponse(reply, wallet, 201);
        },
    );

    app.get(
        '/:id/balances',
        {
            preHandler: [authenticate],
        },
        async (request, reply) => {
            const { id } = request.params as {
                id: string;
            };

            await walletService.getWallet(
                id,
                request.user.id,
                request.user.tenantId,
                request.user.role,
            );

            const balances = await balanceService.getWalletBalances(id);

            return reply.send({
                data: balances,
                requestId: request.id,
            });
        },
    );
}

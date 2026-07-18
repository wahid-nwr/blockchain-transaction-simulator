import { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../common/errors/app.error.js';
import { Prisma } from '@prisma/client';

type FastifyValidationError = FastifyError & {
    validation?: Array<{
        instancePath?: string;
        message?: string;
    }>;
};
type ApplicationError = FastifyError | AppError | Error;
function isFastifyValidationError(error: unknown): error is FastifyValidationError {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }

    return error.code === 'FST_ERR_VALIDATION';
}

export function registerErrorHandler(app: FastifyInstance) {
    app.setErrorHandler(async (error: ApplicationError, request, reply) => {
        app.log.error(error);

        /**
         * Fastify validation error
         */
        if (isFastifyValidationError(error)) {
            const details = error.validation?.map((item) => ({
                field: item.instancePath?.replace('/', '') || 'unknown',

                message: item.message,
            }));

            return reply.status(400).send({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Request validation failed',
                    details,
                },
                requestId: request.id,
                timestamp: new Date().toISOString(),
            });
        }

        /**
         * Domain errors
         */
        if (error instanceof AppError) {
            return reply.status(error.statusCode).send({
                error: {
                    code: error.code,
                    message: error.message,
                    details: error.details,
                },
                requestId: request.id,
                timestamp: new Date().toISOString(),
            });
        }

        /**
         * Prisma errors
         */
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            switch (error.code) {
                /**
                 * Unique constraint violation
                 */
                case 'P2002':
                    return reply.status(409).send({
                        error: {
                            code: 'RESOURCE_ALREADY_EXISTS',
                            message: 'Resource already exists',
                            details: error.meta,
                        },
                        requestId: request.id,
                        timestamp: new Date().toISOString(),
                    });

                /**
                 * Record not found
                 */
                case 'P2025':
                    return reply.status(404).send({
                        error: {
                            code: 'RESOURCE_NOT_FOUND',
                            message: 'Resource not found',
                            details: error.meta,
                        },
                        requestId: request.id,
                        timestamp: new Date().toISOString(),
                    });

                /**
                 * Foreign key violation
                 */
                case 'P2003':
                    return reply.status(400).send({
                        error: {
                            code: 'INVALID_REFERENCE',
                            message: 'Invalid resource reference',
                            details: error.meta,
                        },
                        requestId: request.id,
                        timestamp: new Date().toISOString(),
                    });
                 default:
                    app.log.error(error);

                    return reply.status(500).send({
                        error: {
                            code: 'DATABASE_ERROR',
                            message: 'Database operation failed',
                        },
                        requestId: request.id,
                        timestamp: new Date().toISOString(),
                    });
            }
        }

        /**
         * Unexpected errors
         */
        return reply.status(500).send({
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Unexpected error',
            },
            requestId: request.id,
            timestamp: new Date().toISOString(),
        });
    });
}

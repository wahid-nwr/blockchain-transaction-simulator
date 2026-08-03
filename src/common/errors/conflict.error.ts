import { AppError } from './app.error.js';

export class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super(409, 'CONFLICT', message);
    }
}

import { AppError } from "./app.error.js";

export class ValidationError extends AppError {
    constructor(details?: unknown) {
        super(
            400,
            "VALIDATION_ERROR",
            "Request validation failed",
            details
        );
    }
}
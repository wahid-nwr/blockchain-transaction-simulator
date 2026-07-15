import { AppError } from "./app.error.js";

export class UnauthorizedError extends AppError {
    constructor(
        message = "Unauthorized"
    ) {
        super(
            401,
            "UNAUTHORIZED",
            message
        );
    }
}
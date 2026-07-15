import { AppError } from "./app.error.js";

export class ForbiddenError extends AppError {
    constructor(
        message = "Forbidden"
    ) {
        super(
            403,
            "FORBIDDEN",
            message
        );
    }
}
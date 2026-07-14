import { findUserByEmail, createUser } from "../repositories/user.repository.js";
import { hashPassword, verifyPassword } from "../auth/password.service.js";

export async function register(
    email: string,
    password: string
) {
    const existing = await findUserByEmail(email);
    if (existing) {
        throw new Error(
            "User already exists"
        );
    }
    const passwordHash = await hashPassword(password);
    return createUser({
        email,
        passwordHash
    });
}
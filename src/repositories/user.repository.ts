import { prisma } from "../database/prisma.js";
import { Role } from "@prisma/client";

export class UserRepository {
    async findUserByEmail(
        email: string
    ) {
        return prisma.user.findUnique({
            where: {
                email
            }
        });
    }

    async findUserById(
        id: string
    ) {
        return prisma.user.findUnique({
            where: {
                id
            }
        });
    }

    async createUser(data: {
        email: string;
        passwordHash: string;
        role?: Role;
    }) {
        return prisma.user.create({
            data: {
                email: data.email,
                passwordHash: data.passwordHash,
                role: data.role ?? Role.USER
            }
        });
    }
}
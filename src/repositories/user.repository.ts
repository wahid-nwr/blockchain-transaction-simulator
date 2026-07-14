import { prisma } from "../database/prisma.js";
import { Role } from "@prisma/client";

export async function findUserByEmail(
    email: string
) {
    return prisma.user.findUnique({
        where: {
            email
        }
    });
}

export async function findUserById(
    id: string
) {
    return prisma.user.findUnique({
        where: {
            id
        }
    });
}

export async function createUser(data: {
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
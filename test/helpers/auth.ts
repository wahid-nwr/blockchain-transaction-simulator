import { createTestApp } from "./app.js";
import { createTenant } from "../factories/tenant.factory.js";
import { prisma } from "../../src/database/prisma.js";
import { randomUUID } from "crypto";
import { keccak256, toHex } from "viem";

export async function createAuthenticatedUser() {
    const app = await createTestApp();
    const tenant = await createTenant();
    const email = `user-${Date.now()}@test.com`;
    const password = "password123";

    const registerResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        headers: {
            "x-tenant-key": tenant.apiKey
        },
        payload: {
            email,
            password
        }
    });

    if (registerResponse.statusCode !== 201) {
        throw new Error(
            registerResponse.body
        );
    }

    const user = await prisma.user.findUnique({
        where: {
            email
        }
    });

    if (!user) {
        throw new Error(
            "User was not created"
        );
    }

    const address = `0x${keccak256(toHex(randomUUID())).slice(2,42)}`;
    const wallet = await prisma.wallet.create({
        data: {
            tenantId: tenant.id,
            ownerId: user.id,
            chainId: 31337,
            address: address
        }
    });

    const loginResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
            email,
            password
        }
    });

    if (loginResponse.statusCode !== 200) {
        throw new Error(
            loginResponse.body
        );
    }

    const body = loginResponse.json();

    return {
        app,
        tenant,
        user,
        wallet,
        token: body.data.accessToken,
        email,
        password
    };
}

export async function createAdminUser() {
    const app = await createTestApp();

    const tenant = await createTenant();

    const email = `admin-${Date.now()}@test.com`;

    const password = "password123";

    await app.inject({
        method:"POST",
        url:"/api/v1/auth/register",
        headers:{
            "x-tenant-key":tenant.apiKey
        },
        payload:{
            email,
            password
        }
    });

    const user = await prisma.user.findUnique({
        where:{
            email
        }
    });

    await prisma.user.update({
        where:{
            id:user!.id
        },
        data:{
            role:"ADMIN"
        }
    });

    const login = await app.inject({
        method:"POST",
        url:"/api/v1/auth/login",
        payload:{
            email,
            password
        }
    });

    return {
        app,
        tenant,
        token: login.json().data.accessToken
    };
}
import { describe, it, expect } from "vitest";
import { createTestApp } from "../helpers/app.js";
import { createAuthenticatedUser } from "../helpers/auth.js";

describe("Wallet API", () => {
    it ("gets current user identity", async () => {

        const {
            app,
            token,
            user
        } = await createAuthenticatedUser();

        const response = await app.inject({
            method:"GET",
            url:"/api/v1/wallets/me",
            headers:{
                authorization:`Bearer ${token}`
            }
        });

        expect(response.statusCode)
            .toBe(200);

        const body = response.json();

        expect(body.data.userId)
            .toBe(user.id);

        expect(body.data.email)
            .toBe(user.email);

        await app.close();
    });

    it ("gets current user's wallets", async () => {
        const app = await createTestApp();

        const {
            token,
            wallet
        } = await createAuthenticatedUser();

        const response = await app.inject({
            method:"GET",
            url:"/api/v1/wallets",
            headers:{
                authorization:`Bearer ${token}`
            }
        });

        expect(response.statusCode)
            .toBe(200);

        const body=response.json();

        expect(body.data.length)
            .toBeGreaterThan(0);

        expect(
            body.data.some((w:any) => w.id === wallet.id))
            .toBe(true);

        await app.close();
    });

    it ("rejects missing jwt", async () => {
        const app = await createTestApp();

        const response = await app.inject({
            method:"GET",
            url:"/api/v1/wallets"
        });

        expect(response.statusCode)
            .toBe(401);

        await app.close();
    });

    it ("creates wallet", async () => {
        const {
            app,
            token
        } = await createAuthenticatedUser();

        const response = await app.inject({
            method:"POST",
            url:"/api/v1/wallets",
            headers:{
                authorization:`Bearer ${token}`
            },
            payload:{
                address:"0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
                chainId:31337
            }
        });

        expect(response.statusCode)
            .toBe(201);

        expect(response.json().data.address)
            .toBe("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");

        await app.close();
    });

    it ("gets wallet by id", async () => {
        const {
            app,
            token,
            wallet
        } = await createAuthenticatedUser();

        const response = await app.inject({
            method: "GET",
            url: `/api/v1/wallets/${wallet.id}`,
            headers:{
                authorization:`Bearer ${token}`
            }
        });

        expect(response.statusCode)
            .toBe(200);

        expect(response.json().data.id)
            .toBe(wallet.id);

        await app.close();
    });
});
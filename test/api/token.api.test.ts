import {
    describe,
    it,
    expect
} from "vitest";

import { createAdminUser } from "../helpers/auth.js";
import { randomUUID } from "crypto";

describe("Token API", () => {
    it ("registers token as admin", async () => {
        const {
            app,
            token
        } = await createAdminUser();

        const response = await app.inject({
            method:"POST",
            url:"/api/v1/tokens",
            headers:{
                authorization: `Bearer ${token}`
            },
            payload:{
                tokenId: randomUUID(),
                name:"Mini USDT",
                symbol:"USDT",
                decimals:6,
                contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3"
            }
        });

        expect(response.statusCode)
            .toBe(201);

        const body = response.json();

        expect(body.data)
            .toHaveProperty("id");

        expect(body.data.symbol)
            .toBe("USDT");
    });

    it ("lists tokens for admin", async () => {
        const {
            app,
            token
        } = await createAdminUser();

        const response = await app.inject({
            method:"GET",
            url:"/api/v1/tokens",
            headers:{
                authorization: `Bearer ${token}`
            }
        });

        expect(response.statusCode)
            .toBe(200);

        const body = response.json();

        expect(Array.isArray(body.data))
            .toBe(true);
    });

    it ("gets token by id", async () => {
        const {
            app,
            token
        } = await createAdminUser();

        const create = await app.inject({
            method:"POST",
            url:"/api/v1/tokens",
            headers:{
                authorization: `Bearer ${token}`
            },
            payload:{
                tokenId: randomUUID(),
                name:"Mini USDT",
                symbol:"USDT",
                decimals:6,
                contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3"
            }
        });

        const created = create.json();

        const response = await app.inject({
            method:"GET",
            url: `/api/v1/tokens/${created.data.id}`,
            headers:{
                authorization: `Bearer ${token}`
            }
        });

        expect(response.statusCode)
            .toBe(200);

        expect(response.json().data.id)
            .toBe(created.data.id);
    });
});
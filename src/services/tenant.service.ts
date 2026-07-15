import crypto from "node:crypto";
import { TenantRepository } from "../repositories/tenant.repository.js";
import { AppError } from "../common/errors/app.error.js";

export class TenantService {
    private readonly repository: TenantRepository;

    constructor() {
        this.repository = new TenantRepository();
    }

    async createTenant(
        name: string
    ) {
        const apiKey = `tenant_${crypto.randomBytes(32).toString("hex")}`;
        return this.repository.create({
            name,
            apiKey
        });
    }

    async findByApiKey(
        apiKey:string
    ) {
        const tenant = await this.repository.findByApiKey(
            apiKey
        );
        if(!tenant) {
            throw new AppError(
                401,
                "INVALID_TENANT_KEY",
                "Invalid tenant API key"
            );
        }
        return tenant;
    }
}
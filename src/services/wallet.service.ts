import { getBalance } from "../blockchain/token.js";
import { isAddress } from "viem";

export interface Wallet {
    id:string;
    tenantId:string;
    address:string;
}

export class WalletService {
    async createWallet(
        tenantId:string,
        address:string
    ):Promise<Wallet>
    {
        if(!isAddress(address))
        {
            throw new Error("Invalid wallet address");
        }
        /*
          Later:
          Save into PostgreSQL

          Wallet table:

          id
          tenantId
          address
        */
        return {
            id: crypto.randomUUID(),
            tenantId,
            address
        };
    }

    async getTokenBalance(address:string)
    {
        return getBalance(address);
    }
}
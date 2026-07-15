import { walletClient } from "../blockchain/client.js";
import { LedgerService } from "./ledger.service.js";
import MiniUSDTAbi from "../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json" with {
    type: "json"
};

export class TransferService {
    constructor(
        private readonly ledger: LedgerService
    ) {}

    async transfer(
        request:any
    ) {
        const transaction = await this.ledger.createPending({
            tenantId: request.tenantId,
            tokenId: request.tokenId,
            fromWalletId: request.fromWalletId,
            toWalletId: request.toWalletId,
            amount: request.amount
        });
        try {
            const hash = await walletClient.writeContract({
                account: request.account,
                address: process.env.TOKEN_ADDRESS! as `0x${string}`,
                abi: MiniUSDTAbi.abi,
                functionName:"transfer",
                args:[
                    request.to,
                    request.amount
                ]
            });

            return this.ledger.attachHash(
                transaction.id,
                hash
            );
        } catch(error) {
            await this.ledger.markFailed(transaction.id);
            throw error;
        }
    }
}
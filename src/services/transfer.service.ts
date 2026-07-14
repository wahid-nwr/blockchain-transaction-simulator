import { walletClient } from "../blockchain/client";
import { createAccount } from "../blockchain/wallet";
import { LedgerService, TransactionStatus } from "./ledger.service";
import MiniUSDTAbi from "../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json";

export class TransferService {
    constructor(
        private ledger: LedgerService
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
import { CostModel } from "@midnight-ntwrk/ledger-v8";
import { dappConnectorProofProvider } from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { MidnightProvider, MidnightProviders, WalletProvider } from "@midnight-ntwrk/midnight-js-types";
import { transactionBytesToHex, transactionHexToBytes } from "./bytes";
import {
  BLACKOUT_INVOICE_PRIVATE_STATE_ID,
  createEncryptedInvoicePrivateStateProvider,
  type BlackoutInvoicePrivateState,
} from "./invoice-private-state";
import { assertWalletStillConnected, type ConnectedWallet } from "./wallet";

export type InvoiceCircuitId = "createInvoice" | "acceptInvoice" | "fundInvoice" | "payInvoice";

export type InvoiceProviders = MidnightProviders<
  InvoiceCircuitId,
  typeof BLACKOUT_INVOICE_PRIVATE_STATE_ID,
  BlackoutInvoicePrivateState
>;

function invoiceAssetOrigin(): string {
  if (typeof window === "undefined") throw new Error("Invoice providers can only initialize in the browser");
  if (!window.location.origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(window.location.origin)) {
    throw new Error("Blackout Invoice requires HTTPS outside localhost");
  }
  return `${window.location.origin}/invoice`;
}

export async function buildInvoiceProviders(
  wallet: ConnectedWallet,
  privateStatePassword: string,
): Promise<InvoiceProviders> {
  await assertWalletStillConnected(wallet);
  const zkConfigProvider = new FetchZkConfigProvider<InvoiceCircuitId>(invoiceAssetOrigin(), fetch.bind(window));
  if (typeof wallet.api.getProvingProvider !== "function") {
    throw new Error("Connected wallet does not support delegated proving required by Blackout Invoice");
  }
  const proofProvider = await dappConnectorProofProvider(wallet.api, zkConfigProvider, CostModel.initialCostModel());
  const publicDataProvider = indexerPublicDataProvider(wallet.configuration.indexerUri, wallet.configuration.indexerWsUri);
  const privateStateProvider = createEncryptedInvoicePrivateStateProvider(
    wallet.addresses.shieldedAddress,
    privateStatePassword,
  );

  const walletProvider: WalletProvider = {
    getCoinPublicKey(): ledger.CoinPublicKey {
      return wallet.addresses.shieldedCoinPublicKey as ledger.CoinPublicKey;
    },
    getEncryptionPublicKey(): ledger.EncPublicKey {
      return wallet.addresses.shieldedEncryptionPublicKey as ledger.EncPublicKey;
    },
    async balanceTx(tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>): Promise<ledger.FinalizedTransaction> {
      await assertWalletStillConnected(wallet);
      const balanced = await wallet.api.balanceUnsealedTransaction(transactionBytesToHex(tx.serialize()), { payFees: true });
      if (!balanced.tx?.trim()) throw new Error("Wallet returned no balanced invoice transaction");
      return ledger.Transaction.deserialize("signature", "proof", "binding", transactionHexToBytes(balanced.tx)) as ledger.FinalizedTransaction;
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx: ledger.FinalizedTransaction): Promise<ledger.TransactionId> {
      await assertWalletStillConnected(wallet);
      const [transactionId] = tx.identifiers();
      if (!transactionId) throw new Error("Midnight invoice transaction has no identifier");
      await wallet.api.submitTransaction(transactionBytesToHex(tx.serialize()));
      return transactionId;
    },
  };

  return { privateStateProvider, publicDataProvider, zkConfigProvider, proofProvider, walletProvider, midnightProvider };
}

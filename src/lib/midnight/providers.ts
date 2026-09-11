import { CostModel } from "@midnight-ntwrk/ledger-v8";
import { dappConnectorProofProvider } from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { MidnightProvider, MidnightProviders, WalletProvider } from "@midnight-ntwrk/midnight-js-types";
import { transactionBytesToHex, transactionHexToBytes } from "./bytes";
import {
  BLACKPAY_PRIVATE_STATE_ID,
  type BlackpayPrivateState,
  createEncryptedPrivateStateProvider,
} from "./private-state";
import { assertWalletStillConnected, type ConnectedWallet } from "./wallet";

export type BlackpayCircuitId =
  | "createWorkspace"
  | "addEmployee"
  | "updateEmployee"
  | "removeEmployee"
  | "createPayRun"
  | "registerPayRunPayment"
  | "approvePayRun"
  | "fundPayRunPayment"
  | "claimPayRunPayment"
  | "proveIncomeAtLeast"
  | "createIncomeDisclosure"
  | "createEmploymentDisclosure"
  | "revokeDisclosure";

export type BlackpayProviders = MidnightProviders<
  BlackpayCircuitId,
  typeof BLACKPAY_PRIVATE_STATE_ID,
  BlackpayPrivateState
>;

function assertBrowserAssetOrigin(): string {
  if (typeof window === "undefined") throw new Error("Midnight providers can only be initialized in the browser");
  if (!window.location.origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(window.location.origin)) {
    throw new Error("Blackpay Preview requires HTTPS outside localhost");
  }
  return window.location.origin;
}

export async function buildBlackpayProviders(
  wallet: ConnectedWallet,
  privateStatePassword: string,
): Promise<BlackpayProviders> {
  await assertWalletStillConnected(wallet);
  const assetOrigin = assertBrowserAssetOrigin();

  const zkConfigProvider = new FetchZkConfigProvider<BlackpayCircuitId>(assetOrigin, fetch.bind(window));
  if (typeof wallet.api.getProvingProvider !== "function") {
    throw new Error("Connected wallet does not support delegated proving required by Blackpay");
  }
  const proofProvider = await dappConnectorProofProvider(
    wallet.api,
    zkConfigProvider,
    CostModel.initialCostModel(),
  );

  const publicDataProvider = indexerPublicDataProvider(
    wallet.configuration.indexerUri,
    wallet.configuration.indexerWsUri,
  );

  const privateStateProvider = createEncryptedPrivateStateProvider(
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
    async balanceTx(
      tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>,
      _ttl?: Date,
    ): Promise<ledger.FinalizedTransaction> {
      await assertWalletStillConnected(wallet);
      const serialized = transactionBytesToHex(tx.serialize());
      const balanced = await wallet.api.balanceUnsealedTransaction(serialized, { payFees: true });
      if (!balanced.tx?.trim()) throw new Error("Wallet returned no balanced transaction");
      return ledger.Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        transactionHexToBytes(balanced.tx),
      ) as ledger.FinalizedTransaction;
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx: ledger.FinalizedTransaction): Promise<ledger.TransactionId> {
      await assertWalletStillConnected(wallet);
      const [transactionId] = tx.identifiers();
      if (!transactionId) throw new Error("Midnight transaction has no identifier");
      await wallet.api.submitTransaction(transactionBytesToHex(tx.serialize()));
      return transactionId;
    },
  };

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

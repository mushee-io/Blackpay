import { deployContract, findDeployedContract, submitCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { bytesToHex, hexToBytes32, randomBytes32 } from "./bytes";
import { createCompiledInvoiceContract, type GeneratedInvoiceModule, type InvoiceLedgerView } from "./invoice-generated-contract";
import {
  BLACKOUT_INVOICE_PRIVATE_STATE_ID,
  activateInvoiceWitness,
  createInitialInvoicePrivateState,
  upsertInvoiceWitness,
  type BlackoutInvoicePrivateState,
} from "./invoice-private-state";
import { buildInvoiceProviders, type InvoiceCircuitId, type InvoiceProviders } from "./invoice-providers";
import { assertWalletStillConnected, type ConnectedWallet } from "./wallet";
import { assertInvoiceWitness, type ConfidentialInvoiceDraft, type PrivateInvoiceWitness } from "../invoice/types";

export type InvoiceRuntimeStatus = {
  ready: boolean;
  contractAddress?: string;
  networkId?: string;
  protocolVersion?: number;
};

type LiveInvoiceRuntime = {
  wallet: ConnectedWallet;
  providers: InvoiceProviders;
  compiledContract: any;
  generated: GeneratedInvoiceModule;
  contractAddress: ContractAddress;
};

type FinalizedCall = { public: { txId: string }; private: { result: unknown } };
let runtime: LiveInvoiceRuntime | undefined;

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function requireRuntime(): LiveInvoiceRuntime {
  if (!runtime) throw new Error("Blackout Invoice live runtime is not initialized");
  return runtime;
}

async function queryLedger(current: LiveInvoiceRuntime): Promise<InvoiceLedgerView | null> {
  await assertWalletStillConnected(current.wallet);
  const state = await current.providers.publicDataProvider.queryContractState(current.contractAddress);
  if (!state) return null;
  const ledger = current.generated.ledger(state.data);
  if (BigInt(ledger.protocolVersion) !== 1n) throw new Error("Deployed contract is not Blackout Invoice protocol v1");
  return ledger;
}

async function confirmLedger(
  current: LiveInvoiceRuntime,
  description: string,
  predicate: (ledger: InvoiceLedgerView) => boolean,
): Promise<InvoiceLedgerView> {
  let latest: InvoiceLedgerView | null = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    latest = await queryLedger(current);
    if (latest && predicate(latest)) return latest;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  if (!latest) throw new Error(`Midnight indexer did not return invoice state after ${description}`);
  throw new Error(`Blackout Invoice state did not confirm ${description} after transaction finalization`);
}

async function getPrivateState(current: LiveInvoiceRuntime): Promise<BlackoutInvoicePrivateState> {
  current.providers.privateStateProvider.setContractAddress(current.contractAddress);
  const state = await current.providers.privateStateProvider.get(BLACKOUT_INVOICE_PRIVATE_STATE_ID);
  if (!state) throw new Error("Encrypted Blackout Invoice private state is missing");
  return state;
}

async function setPrivateState(current: LiveInvoiceRuntime, state: BlackoutInvoicePrivateState): Promise<void> {
  current.providers.privateStateProvider.setContractAddress(current.contractAddress);
  await current.providers.privateStateProvider.set(BLACKOUT_INVOICE_PRIVATE_STATE_ID, state);
}

async function submitCircuit(current: LiveInvoiceRuntime, circuitId: InvoiceCircuitId, args: unknown[]): Promise<FinalizedCall> {
  await assertWalletStillConnected(current.wallet);
  const result = await submitCallTx(current.providers as any, {
    compiledContract: current.compiledContract,
    contractAddress: current.contractAddress,
    circuitId,
    args,
    privateStateId: BLACKOUT_INVOICE_PRIVATE_STATE_ID,
  } as any);
  if (!result.public.txId) throw new Error(`Midnight returned no transaction ID for ${circuitId}`);
  return result as unknown as FinalizedCall;
}

export async function initializeBlackoutInvoice(params: {
  wallet: ConnectedWallet;
  privateStatePassword: string;
  mode: "deploy" | "join";
  contractAddress?: string;
}): Promise<{ contractAddress: string; deploymentTransactionId?: string }> {
  clearBlackoutInvoiceRuntime();
  const providers = await buildInvoiceProviders(params.wallet, params.privateStatePassword);
  const { generated, compiledContract } = await createCompiledInvoiceContract();
  let contractAddress: ContractAddress;
  let deploymentTransactionId: string | undefined;

  if (params.mode === "deploy") {
    const deployed = await deployContract(providers as any, {
      compiledContract,
      privateStateId: BLACKOUT_INVOICE_PRIVATE_STATE_ID,
      initialPrivateState: createInitialInvoicePrivateState(),
    } as any);
    contractAddress = deployed.deployTxData.public.contractAddress;
    deploymentTransactionId = deployed.deployTxData.public.txId;
  } else {
    if (!params.contractAddress?.trim()) throw new Error("A deployed Blackout Invoice contract address is required to join");
    contractAddress = params.contractAddress.trim() as ContractAddress;
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(BLACKOUT_INVOICE_PRIVATE_STATE_ID);
    await findDeployedContract(providers as any, {
      contractAddress,
      compiledContract,
      privateStateId: BLACKOUT_INVOICE_PRIVATE_STATE_ID,
      ...(existing ? {} : { initialPrivateState: createInitialInvoicePrivateState() }),
    } as any);
  }

  providers.privateStateProvider.setContractAddress(contractAddress);
  runtime = { wallet: params.wallet, providers, compiledContract, generated, contractAddress };
  await confirmLedger(runtime, "invoice runtime initialization", () => true);
  return { contractAddress: String(contractAddress), ...(deploymentTransactionId ? { deploymentTransactionId } : {}) };
}

export function clearBlackoutInvoiceRuntime(): void {
  runtime = undefined;
}

export function getBlackoutInvoiceRuntimeStatus(): InvoiceRuntimeStatus {
  if (!runtime) return { ready: false };
  return { ready: true, contractAddress: String(runtime.contractAddress), networkId: runtime.wallet.networkId, protocolVersion: 1 };
}

export async function createConfidentialInvoice(input: ConfidentialInvoiceDraft): Promise<{
  transactionId: string;
  commitmentHex: string;
}> {
  const current = requireRuntime();
  assertInvoiceWitness(input.witness);
  const invoiceId = hexToBytes32(input.invoiceIdHex, "invoice id");
  const tokenColor = hexToBytes32(input.tokenColorHex, "invoice token color");
  let state = await getPrivateState(current);
  state = upsertInvoiceWitness(state, input.invoiceIdHex, input.witness);
  await setPrivateState(current, state);

  const expected = current.generated.pureCircuits.invoiceCommitment(
    invoiceId,
    input.witness.amountMinor,
    input.witness.taxMinor,
    hexToBytes32(input.witness.payerCommitmentHex, "payer commitment"),
    hexToBytes32(input.witness.supplierCoinPublicKeyHex, "supplier coin public key"),
    input.witness.dueAt,
    hexToBytes32(input.witness.saltHex, "invoice salt"),
  );

  const result = await submitCircuit(current, "createInvoice", [invoiceId, tokenColor]);
  await confirmLedger(current, "invoice creation", (ledger) => {
    if (!ledger.invoices.member(invoiceId)) return false;
    const entry = ledger.invoices.lookup(invoiceId);
    return entry.status === current.generated.InvoiceStatus.Created && equalBytes(entry.commitment, expected) && equalBytes(entry.tokenColor, tokenColor);
  });
  return { transactionId: result.public.txId, commitmentHex: bytesToHex(expected) };
}

export async function acceptConfidentialInvoice(input: {
  invoiceIdHex: string;
  witness: PrivateInvoiceWitness;
  nonceHex?: string;
}): Promise<{ transactionId: string; acceptanceNullifierHex: string }> {
  const current = requireRuntime();
  assertInvoiceWitness(input.witness);
  const invoiceId = hexToBytes32(input.invoiceIdHex, "invoice id");
  const nonce = input.nonceHex ? hexToBytes32(input.nonceHex, "acceptance nonce") : randomBytes32();
  let state = upsertInvoiceWitness(await getPrivateState(current), input.invoiceIdHex, input.witness);
  state = activateInvoiceWitness(state, input.invoiceIdHex);
  await setPrivateState(current, state);

  const before = await confirmLedger(current, "invoice acceptance precheck", (ledger) => ledger.invoices.member(invoiceId));
  const entry = before.invoices.lookup(invoiceId);
  if (entry.status !== current.generated.InvoiceStatus.Created) throw new Error("Invoice is not in CREATED state");
  const expectedNullifier = current.generated.pureCircuits.invoiceAcceptanceNullifier(invoiceId, entry.commitment, nonce);
  const result = await submitCircuit(current, "acceptInvoice", [invoiceId, nonce]);
  await confirmLedger(current, "invoice acceptance", (ledger) => {
    if (!ledger.invoices.member(invoiceId)) return false;
    const next = ledger.invoices.lookup(invoiceId);
    return next.status === current.generated.InvoiceStatus.Accepted && equalBytes(next.acceptanceNullifier, expectedNullifier);
  });
  return { transactionId: result.public.txId, acceptanceNullifierHex: bytesToHex(expectedNullifier) };
}

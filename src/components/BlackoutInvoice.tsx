"use client";

import { useMemo, useState } from "react";
import { connectMidnightWallet, type ConnectedWallet } from "@/lib/midnight/wallet";
import { connectedShieldedCoinPublicKeyHex } from "@/lib/midnight/shielded-address";
import {
  acceptConfidentialInvoice,
  createConfidentialInvoice,
  fundConfidentialInvoice,
  getBlackoutInvoiceRuntimeStatus,
  initializeBlackoutInvoice,
  payConfidentialInvoice,
} from "@/lib/midnight/invoice-runtime";
import type { PrivateInvoiceWitness } from "@/lib/invoice/types";
import styles from "./BlackoutInvoice.module.css";

function randomHex32(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cleanHex32(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be 32-byte hex`);
  return normalized;
}

export function BlackoutInvoice() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [privateStatePassword, setPrivateStatePassword] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [invoiceIdHex, setInvoiceIdHex] = useState(() => randomHex32());
  const [tokenColorHex, setTokenColorHex] = useState("");
  const [payerCommitmentHex, setPayerCommitmentHex] = useState(() => randomHex32());
  const [supplierCoinPublicKeyHex, setSupplierCoinPublicKeyHex] = useState("");
  const [saltHex, setSaltHex] = useState(() => randomHex32());
  const [amountMinor, setAmountMinor] = useState("1000000");
  const [taxMinor, setTaxMinor] = useState("0");
  const [dueAt, setDueAt] = useState(() => String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [lastTransactionId, setLastTransactionId] = useState("");
  const [commitmentHex, setCommitmentHex] = useState("");
  const runtimeStatus = getBlackoutInvoiceRuntimeStatus();

  const witness = useMemo<PrivateInvoiceWitness | null>(() => {
    try {
      return {
        amountMinor: BigInt(amountMinor),
        taxMinor: BigInt(taxMinor),
        payerCommitmentHex: cleanHex32(payerCommitmentHex, "Payer commitment"),
        supplierCoinPublicKeyHex: cleanHex32(supplierCoinPublicKeyHex, "Supplier coin public key"),
        dueAt: BigInt(dueAt),
        saltHex: cleanHex32(saltHex, "Invoice salt"),
      };
    } catch {
      return null;
    }
  }, [amountMinor, taxMinor, payerCommitmentHex, supplierCoinPublicKeyHex, dueAt, saltHex]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    await run(async () => {
      const connected = await connectMidnightWallet();
      setWallet(connected);
      setSupplierCoinPublicKeyHex(connectedShieldedCoinPublicKeyHex(connected.addresses.shieldedCoinPublicKey, connected.networkId));
      setNotice(`Lace connected on ${connected.networkId}. No invoice transaction has been submitted yet.`);
    });
  }

  async function initialize(mode: "deploy" | "join") {
    await run(async () => {
      const activeWallet = wallet ?? await connectMidnightWallet();
      if (!wallet) setWallet(activeWallet);
      if (!privateStatePassword) throw new Error("Enter the encrypted private-state password first");
      const result = await initializeBlackoutInvoice({
        wallet: activeWallet,
        privateStatePassword,
        mode,
        contractAddress: mode === "join" ? contractAddress : undefined,
      });
      setContractAddress(result.contractAddress);
      setNotice(mode === "deploy"
        ? `Blackout Invoice deployed and indexed. Deployment transaction: ${result.deploymentTransactionId ?? "confirmed"}.`
        : "Verified Blackout Invoice contract joined.");
    });
  }

  function requireWitness(): PrivateInvoiceWitness {
    if (!witness) throw new Error("Complete the private invoice fields with valid values first");
    return witness;
  }

  async function createInvoice() {
    await run(async () => {
      const result = await createConfidentialInvoice({
        invoiceIdHex: cleanHex32(invoiceIdHex, "Invoice id"),
        tokenColorHex: cleanHex32(tokenColorHex, "Token color"),
        witness: requireWitness(),
      });
      setLastTransactionId(result.transactionId);
      setCommitmentHex(result.commitmentHex);
      setNotice("CREATED confirmed by the Midnight ledger. Private invoice fields remain in encrypted witness state.");
    });
  }

  async function acceptInvoice() {
    await run(async () => {
      const result = await acceptConfidentialInvoice({ invoiceIdHex: cleanHex32(invoiceIdHex, "Invoice id"), witness: requireWitness() });
      setLastTransactionId(result.transactionId);
      setNotice(`ACCEPTED confirmed. Nullifier ${result.acceptanceNullifierHex.slice(0, 16)}…`);
    });
  }

  async function fundInvoice() {
    await run(async () => {
      const result = await fundConfidentialInvoice(cleanHex32(invoiceIdHex, "Invoice id"));
      setLastTransactionId(result.transactionId);
      setNotice(`FUNDED confirmed with ${result.candidateMtIndices.length} indexer commitment candidate(s).`);
    });
  }

  async function payInvoice() {
    await run(async () => {
      const result = await payConfidentialInvoice({ invoiceIdHex: cleanHex32(invoiceIdHex, "Invoice id") });
      setLastTransactionId(result.transactionId);
      setNotice(`PAID confirmed by Midnight. Payment nullifier ${result.paymentNullifierHex.slice(0, 16)}…`);
    });
  }

  function rotateInvoiceSecrets() {
    setInvoiceIdHex(randomHex32());
    setPayerCommitmentHex(randomHex32());
    setSaltHex(randomHex32());
    setCommitmentHex("");
    setLastTransactionId("");
    setNotice("New local invoice identifiers generated. Nothing has been submitted.");
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.kicker}>BLACKOUT / INVOICE / LIVE</div>
        <h1>Get paid. Prove it happened. Reveal nothing else.</h1>
        <p>Milestones 1–5 operator workspace. Every lifecycle change below requires a real Lace/Midnight transaction and ledger confirmation.</p>
      </header>

      <section className={styles.panel}>
        <div className={styles.panelHead}><span>01</span><h2>Runtime</h2></div>
        <div className={styles.grid2}>
          <label>Contract address<input value={contractAddress} onChange={(event) => setContractAddress(event.target.value)} placeholder="Deploy new or paste existing contract" /></label>
          <label>Encrypted private-state password<input type="password" value={privateStatePassword} onChange={(event) => setPrivateStatePassword(event.target.value)} placeholder="16+ chars, 3 character classes" /></label>
        </div>
        <div className={styles.actions}>
          <button disabled={busy} onClick={connect}>CONNECT LACE</button>
          <button disabled={busy} onClick={() => initialize("deploy")}>DEPLOY INVOICE CONTRACT</button>
          <button disabled={busy || !contractAddress.trim()} onClick={() => initialize("join")}>JOIN CONTRACT</button>
        </div>
        <div className={styles.runtimeLine}>
          <span>{wallet ? `WALLET ${wallet.networkId.toUpperCase()}` : "WALLET DISCONNECTED"}</span>
          <span>{runtimeStatus.ready ? "RUNTIME READY" : "RUNTIME CLOSED"}</span>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><span>02</span><h2>Private invoice witness</h2></div>
        <div className={styles.grid2}>
          <label>Invoice id / committed<input value={invoiceIdHex} onChange={(event) => setInvoiceIdHex(event.target.value)} /></label>
          <label>Midnight token color / public<input value={tokenColorHex} onChange={(event) => setTokenColorHex(event.target.value)} placeholder="64 hex chars" /></label>
          <label>Amount minor / private<input inputMode="numeric" value={amountMinor} onChange={(event) => setAmountMinor(event.target.value)} /></label>
          <label>Tax minor / private<input inputMode="numeric" value={taxMinor} onChange={(event) => setTaxMinor(event.target.value)} /></label>
          <label>Payer commitment / committed<input value={payerCommitmentHex} onChange={(event) => setPayerCommitmentHex(event.target.value)} /></label>
          <label>Supplier shielded payout key / private<input value={supplierCoinPublicKeyHex} onChange={(event) => setSupplierCoinPublicKeyHex(event.target.value)} /></label>
          <label>Due time Unix seconds / private<input inputMode="numeric" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          <label>Invoice salt / private<input value={saltHex} onChange={(event) => setSaltHex(event.target.value)} /></label>
        </div>
        <button className={styles.secondary} disabled={busy} onClick={rotateInvoiceSecrets}>GENERATE NEW LOCAL INVOICE</button>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><span>03</span><h2>Ledger lifecycle</h2></div>
        <div className={styles.lifecycle}><b>CREATED</b><i>→</i><b>ACCEPTED</b><i>→</i><b>FUNDED</b><i>→</i><b>PAID</b></div>
        <div className={styles.actions}>
          <button disabled={busy || !runtimeStatus.ready} onClick={createInvoice}>1. CREATE</button>
          <button disabled={busy || !runtimeStatus.ready} onClick={acceptInvoice}>2. ACCEPT</button>
          <button disabled={busy || !runtimeStatus.ready} onClick={fundInvoice}>3. FUND</button>
          <button disabled={busy || !runtimeStatus.ready} onClick={payInvoice}>4. SETTLE</button>
        </div>
        {commitmentHex && <div className={styles.proofLine}><span>INVOICE COMMITMENT</span><code>{commitmentHex}</code></div>}
        {lastTransactionId && <div className={styles.proofLine}><span>LAST REAL TX</span><code>{lastTransactionId}</code></div>}
      </section>

      <section className={styles.privacy}>
        <div><span>PUBLIC</span><p>Invoice id, commitment, token color, lifecycle status, action nullifiers.</p></div>
        <div><span>PRIVATE</span><p>Amount, tax, payer source data, supplier payout key, due date and salt remain in encrypted witness state except where the underlying settlement primitive necessarily consumes them.</p></div>
      </section>

      {(notice || failure) && <div className={failure ? styles.failure : styles.notice}>{failure || notice}</div>}
    </main>
  );
}

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getPayrollContractGateway } from "@/lib/midnight/contract-client";
import { assertEmployeeAccessEnvelope, type EmployeeAccessEnvelope } from "@/lib/midnight/employee-access";
import {
  getEmployeePortalSnapshot,
  getEmployeePortalWitness,
  getBlackpayRuntimeStatus,
  importEmployeeAccessPackage,
  initializeBlackpayPreview,
  type EmployeePortalSnapshot,
} from "@/lib/midnight/live-runtime";
import { getMidnightPublicConfig } from "@/lib/midnight/network";
import {
  connectMidnightWallet,
  listMidnightWallets,
  type AvailableWallet,
  type ConnectedWallet,
} from "@/lib/midnight/wallet";
import { sha256Hex } from "@/lib/payroll/commitments";
import { newPrivateSaltHex } from "@/lib/payroll/validation";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Blackpay employee portal error";
}

function contractStorageKey(network: string): string {
  return `blackpay:${network}:contract-address`;
}

function parsePositiveBigInt(value: string, label: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a positive integer`);
  }
}

function toFutureEpochSeconds(value: string): bigint {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || ms <= Date.now()) throw new Error("Disclosure expiry must be in the future");
  return BigInt(Math.floor(ms / 1000));
}

function money(value: bigint, currencyCode: string): string {
  return `${value.toString()} ${currencyCode}`;
}

export function EmployeePortal() {
  const config = useMemo(() => getMidnightPublicConfig(), []);
  const [wallets, setWallets] = useState<AvailableWallet[]>([]);
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [privateStatePassword, setPrivateStatePassword] = useState("");
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [snapshot, setSnapshot] = useState<EmployeePortalSnapshot | null>(null);
  const [accessEnvelope, setAccessEnvelope] = useState<EmployeeAccessEnvelope | null>(null);
  const [accessFileName, setAccessFileName] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [incomeThreshold, setIncomeThreshold] = useState("");
  const [verifierRef, setVerifierRef] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    setWallets(listMidnightWallets());
    setContractAddress(window.localStorage.getItem(contractStorageKey(config.network)) ?? config.contractAddress);
    setRuntimeReady(getBlackpayRuntimeStatus().ready);
  }, [config.contractAddress, config.network]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    setFailure("");
    try {
      await action();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPortal(silent = false) {
    try {
      const next = await getEmployeePortalSnapshot();
      setSnapshot(next);
      if (!silent) setNotice("Employee payslips loaded from wallet-scoped encrypted private state.");
    } catch (error) {
      setSnapshot(null);
      if (!silent) throw error;
    }
  }

  async function connect(walletId?: string) {
    await run(async () => {
      const wallet = await connectMidnightWallet(walletId);
      setConnected(wallet);
      setNotice(`Connected ${wallet.name} on ${wallet.networkId}. Join the Blackpay contract to unlock private employee data.`);
    });
  }

  async function joinRuntime(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect Lace first");
      if (!contractAddress.trim()) throw new Error("Enter the Blackpay contract address or load an employee access package");
      if (!privateStatePassword) throw new Error("Enter your employee private-state password");
      const result = await initializeBlackpayPreview({
        wallet: connected,
        privateStatePassword,
        mode: "join",
        contractAddress: contractAddress.trim(),
      });
      window.localStorage.setItem(contractStorageKey(config.network), result.contractAddress);
      setContractAddress(result.contractAddress);
      setRuntimeReady(true);
      setPrivateStatePassword("");
      await refreshPortal(true);
      setNotice(
        snapshot
          ? "Verified Blackpay contract joined. Your encrypted employee portal is ready."
          : "Verified Blackpay contract joined. Import your employer-issued access package if this is your first visit.",
      );
    });
  }

  async function loadAccessFile(file: File | null) {
    await run(async () => {
      if (!file) {
        setAccessEnvelope(null);
        setAccessFileName("");
        return;
      }
      if (file.size > 1_500_000) throw new Error("Employee access package is unexpectedly large");
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error("Employee access package is not valid JSON");
      }
      const envelope = assertEmployeeAccessEnvelope(parsed);
      if (envelope.networkId !== config.network) throw new Error(`This package belongs to ${envelope.networkId}, not ${config.network}`);
      setAccessEnvelope(envelope);
      setAccessFileName(file.name);
      setContractAddress(envelope.contractAddress);
      window.localStorage.setItem(contractStorageKey(config.network), envelope.contractAddress);
      setNotice("Employee access package loaded. Connect the bound Lace wallet, join the contract, then import the package.");
    });
  }

  async function importAccess() {
    await run(async () => {
      if (!runtimeReady) throw new Error("Join the verified Blackpay contract first");
      if (!accessEnvelope) throw new Error("Choose the encrypted employee access package from your employer");
      if (!accessPassword) throw new Error("Enter the employee access package password");
      const next = await importEmployeeAccessPackage(accessEnvelope, accessPassword);
      setSnapshot(next);
      setAccessPassword("");
      setNotice("Employee access installed. This Lace wallet can now reopen its private payslips from encrypted local state.");
    });
  }

  async function proveIncome(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!snapshot) throw new Error("Load your employee portal first");
      const thresholdMinor = parsePositiveBigInt(incomeThreshold, "Income threshold");
      const { employeeIdHex, witness } = await getEmployeePortalWitness();
      const result = await getPayrollContractGateway().proveIncomeAtLeast({
        employeeIdHex,
        thresholdMinor,
        nonceHex: newPrivateSaltHex(),
        witness,
      });
      setNotice(`Income proof ${result.proofIdHex} submitted in ${result.transactionId}. Your exact salary was not disclosed.`);
    });
  }

  async function proveEmployment() {
    await run(async () => {
      if (!snapshot) throw new Error("Load your employee portal first");
      if (!verifierRef.trim()) throw new Error("Verifier reference is required");
      const { employeeIdHex, witness } = await getEmployeePortalWitness();
      const verifierIdHex = await sha256Hex(`blackpay:verifier:v1:${verifierRef.trim()}`);
      const result = await getPayrollContractGateway().createEmploymentDisclosure({
        employeeIdHex,
        verifierIdHex,
        expiresAt: toFutureEpochSeconds(expiresAt),
        nonceHex: newPrivateSaltHex(),
        witness,
      });
      setNotice(`Employment disclosure ${result.disclosureIdHex} created in ${result.transactionId}.`);
    });
  }

  return (
    <main className="shell employeePortalShell">
      <header className="topbar">
        <div>
          <div className="eyebrow">BLACKPAY / EMPLOYEE</div>
          <h1>MY PAY</h1>
        </div>
        <div className="topActions">
          <a className="secondary" href="/">EMPLOYER</a>
          <span className="network">{config.network.toUpperCase()}</span>
          {connected ? (
            <span className="walletConnected">{connected.name}</span>
          ) : wallets.length <= 1 ? (
            <button className="primary" disabled={busy} onClick={() => connect(wallets[0]?.id)}>CONNECT LACE</button>
          ) : (
            wallets.map((wallet) => (
              <button className="secondary" disabled={busy} key={wallet.id} onClick={() => connect(wallet.id)}>{wallet.name}</button>
            ))
          )}
        </div>
      </header>

      <section className="hero employeeHero">
        <p className="kicker">YOUR PAY. YOUR PROOFS. NOT EVERYONE ELSE'S BUSINESS.</p>
        <h2>See your payslips privately.</h2>
        <p className="heroCopy">Your employer gives you one encrypted access package. Blackpay verifies it against your connected Lace shielded wallet and the live employee commitment. After import, your records stay encrypted in your own wallet-scoped browser storage.</p>
      </section>

      <section className="statusGrid">
        <article className="statusCard"><span>WALLET</span><strong>{connected ? "CONNECTED" : "CONNECT"}</strong></article>
        <article className="statusCard"><span>CONTRACT</span><strong>{runtimeReady ? "VERIFIED / JOINED" : "JOIN REQUIRED"}</strong></article>
        <article className="statusCard"><span>EMPLOYEE ACCESS</span><strong>{snapshot ? "UNLOCKED" : "LOCKED"}</strong></article>
        <article className="statusCard"><span>PRIVACY</span><strong>LOCAL + ENCRYPTED</strong></article>
      </section>

      {(notice || failure) && <section className={failure ? "message error" : "message success"}>{failure || notice}</section>}

      <section className="workspaceGrid">
        <form className="panel wide" onSubmit={joinRuntime}>
          <div className="panelNumber">01 / VERIFY</div>
          <h3>Join your employer's Blackpay contract</h3>
          <p>The contract address is public. Your private-state password never leaves this browser.</p>
          <div className="twoCol">
            <label>Contract address<input value={contractAddress} onChange={(event) => setContractAddress(event.target.value)} placeholder="Blackpay Midnight contract address" autoComplete="off" /></label>
            <label>Employee private-state password<input type="password" value={privateStatePassword} onChange={(event) => setPrivateStatePassword(event.target.value)} placeholder="16+ chars, 3 character classes" autoComplete="new-password" /></label>
          </div>
          <button className="primary" disabled={busy || !connected || !contractAddress.trim()}>JOIN VERIFIED CONTRACT</button>
        </form>

        <section className="panel wide">
          <div className="panelNumber">02 / FIRST ACCESS</div>
          <h3>Import employee access</h3>
          <p>This one-time encrypted package contains only your employee witness and private payslips. Blackpay rejects it if the connected Lace shielded wallet does not match the payout commitment your employer originally registered.</p>
          <div className="twoCol">
            <label>Employee access package<input type="file" accept="application/json,.json" onChange={(event) => void loadAccessFile(event.target.files?.[0] ?? null)} /></label>
            <label>Access package password<input type="password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} placeholder="Password shared by employer" autoComplete="off" /></label>
          </div>
          {accessFileName && <p>Loaded: <code>{accessFileName}</code></p>}
          <button className="primary" type="button" disabled={busy || !runtimeReady || !accessEnvelope} onClick={importAccess}>VERIFY WALLET + IMPORT ACCESS</button>
        </section>

        {snapshot ? (
          <>
            <section className="panel wide">
              <div className="panelNumber">03 / PAYSLIPS</div>
              <h3>My private payslips</h3>
              <p>Employee status: <strong>{snapshot.status.toUpperCase()}</strong>. Salary and payment values below come from encrypted employee state, not public ledger fields.</p>
              <div className="payslipGrid">
                {snapshot.payslips.length ? snapshot.payslips.map((payslip) => (
                  <article className="payslipCard" key={`${payslip.employeeIdHex}:${payslip.payRunIdHex}`}>
                    <div className="payslipHeader"><span>PERIOD {payslip.period}</span><strong>{payslip.status.toUpperCase()}</strong></div>
                    <div className="payslipAmount">{money(payslip.netMinor, payslip.currencyCode)}</div>
                    <dl>
                      <div><dt>Gross</dt><dd>{money(payslip.grossMinor, payslip.currencyCode)}</dd></div>
                      <div><dt>Net</dt><dd>{money(payslip.netMinor, payslip.currencyCode)}</dd></div>
                      <div><dt>Settlement</dt><dd>{payslip.paymentTransactionId ? `${payslip.paymentTransactionId.slice(0, 12)}…` : "NOT SETTLED"}</dd></div>
                    </dl>
                  </article>
                )) : <div className="message success">Your employee access is valid, but no payslips have been issued yet.</div>}
              </div>
              <button className="secondary" type="button" disabled={busy} onClick={() => void run(() => refreshPortal())}>REFRESH MY PAYSLIPS</button>
            </section>

            <form className="panel" onSubmit={proveIncome}>
              <div className="panelNumber">04 / INCOME PROOF</div>
              <h3>Prove income</h3>
              <p>Prove that your salary meets a threshold without exposing your exact salary.</p>
              <label>Threshold in minor units<input inputMode="numeric" value={incomeThreshold} onChange={(event) => setIncomeThreshold(event.target.value)} placeholder="250000" /></label>
              <button className="primary full" disabled={busy}>GENERATE PRIVATE INCOME PROOF</button>
            </form>

            <section className="panel">
              <div className="panelNumber">05 / EMPLOYMENT PROOF</div>
              <h3>Prove employment</h3>
              <p>Create a verifier-scoped, expiring proof that you are an active employee.</p>
              <label>Verifier reference<input value={verifierRef} onChange={(event) => setVerifierRef(event.target.value)} placeholder="landlord-or-lender" /></label>
              <label>Expires at<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
              <button className="primary full" type="button" disabled={busy} onClick={proveEmployment}>PROVE ACTIVE EMPLOYMENT</button>
            </section>
          </>
        ) : (
          <section className="panel wide lockedPortal">
            <div className="panelNumber">03 / LOCKED</div>
            <h3>Your payslips stay hidden until wallet verification succeeds.</h3>
            <p>No salary or payslip data is fetched into this view until the encrypted access record matches the connected Lace payout commitment.</p>
          </section>
        )}
      </section>
    </main>
  );
}

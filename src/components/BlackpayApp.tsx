"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getMidnightPublicConfig } from "@/lib/midnight/network";
import {
  connectMidnightWallet,
  listMidnightWallets,
  type AvailableWallet,
  type ConnectedWallet,
} from "@/lib/midnight/wallet";
import {
  getPayrollContractGateway,
  isPayrollContractGatewayReady,
  subscribePayrollContractGateway,
  type PrivateSettlementPayment,
} from "@/lib/midnight/contract-client";
import {
  recordPortalPayslipsForPayRun,
  rememberPrivateWorkspaceCurrency,
} from "@/lib/midnight/live-runtime";
import { assertTokenColorHex, shieldedCoinPublicKeyHex } from "@/lib/midnight/shielded-address";
import { payoutCommitment, sha256Hex } from "@/lib/payroll/commitments";
import { getEmployeeWitness, putEmployeeWitness } from "@/lib/payroll/session-store";
import { newPrivateSaltHex } from "@/lib/payroll/validation";
import type { PayrollFrequency, PrivatePayrollPayment } from "@/lib/payroll/types";

type PreparedPayRun = {
  payRunIdHex: string;
  payments: PrivatePayrollPayment[];
};

type ShieldedTokenBalance = {
  type: string;
  balance: bigint;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Blackpay error";
}

async function privateId(domain: string, value: string): Promise<string> {
  if (!value.trim()) throw new Error("Identifier is required");
  return sha256Hex(`${domain}:${value.trim()}`);
}

function parsePaymentRows(value: string): PrivatePayrollPayment[] {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("Add at least one payroll row");
  return lines.map((line, index) => {
    const [employeeId, amount, shieldedRecipient, ...extra] = line.split("|").map((item) => item.trim());
    if (!employeeId || !amount || !shieldedRecipient || extra.length > 0) {
      throw new Error(`Payroll row ${index + 1} must be employee-id | minor-units | shielded-recipient`);
    }
    let salaryMinor: bigint;
    try {
      salaryMinor = BigInt(amount);
    } catch {
      throw new Error(`Payroll row ${index + 1} has an invalid integer amount`);
    }
    if (salaryMinor <= 0n || salaryMinor > ((1n << 64n) - 1n)) throw new Error(`Payroll row ${index + 1} amount is outside the supported range`);
    return { employeeId, salaryMinor, shieldedRecipient };
  });
}

function shortToken(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function BlackpayApp() {
  const config = useMemo(() => getMidnightPublicConfig(), []);
  const [wallets, setWallets] = useState<AvailableWallet[]>([]);
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [preparedRuns, setPreparedRuns] = useState<Record<string, PreparedPayRun>>({});
  const [tokenBalances, setTokenBalances] = useState<ShieldedTokenBalance[]>([]);
  const [payrollTokenType, setPayrollTokenType] = useState(config.payrollTokenType ?? "");

  const [companyName, setCompanyName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [frequency, setFrequency] = useState<PayrollFrequency>("monthly");
  const [employeeId, setEmployeeId] = useState("");
  const [salaryMinor, setSalaryMinor] = useState("");
  const [shieldedRecipient, setShieldedRecipient] = useState("");
  const [payRunId, setPayRunId] = useState("");
  const [payPeriod, setPayPeriod] = useState("");
  const [paymentRows, setPaymentRows] = useState("");
  const [proofEmployeeId, setProofEmployeeId] = useState("");
  const [proofThreshold, setProofThreshold] = useState("");

  useEffect(() => {
    setWallets(listMidnightWallets());
    setRuntimeReady(isPayrollContractGatewayReady());
    return subscribePayrollContractGateway(setRuntimeReady);
  }, []);

  useEffect(() => {
    if (connected && runtimeReady) {
      setFailure("");
      setNotice(`Blackpay protocol v2 runtime active on ${config.network}. Contract-bound payroll actions are enabled.`);
    }
  }, [connected, runtimeReady, config.network]);

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

  async function connect(walletId?: string) {
    await run(async () => {
      const connection = await connectMidnightWallet(walletId);
      setConnected(connection);
      const balances = await connection.api.getShieldedBalances();
      const supported: ShieldedTokenBalance[] = [];
      for (const [type, balance] of Object.entries(balances)) {
        try {
          const rawType = assertTokenColorHex(type);
          if (balance > 0n) supported.push({ type: rawType, balance });
        } catch {
          // Ignore wallet balance entries that are not raw shielded token types.
        }
      }
      setTokenBalances(supported);
      const configured = config.payrollTokenType ? (() => {
        try { return assertTokenColorHex(config.payrollTokenType); } catch { return ""; }
      })() : "";
      const selected = supported.find((entry) => entry.type === configured)?.type ?? supported[0]?.type ?? configured;
      setPayrollTokenType(selected || "");
      setNotice(`Connected to ${connection.name} on ${config.network}. ${supported.length ? `${supported.length} spendable shielded token type(s) detected.` : "No spendable raw shielded token type was detected."}`);
    });
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      if (!companyName.trim()) throw new Error("Company name is required");
      if (!currencyCode.trim()) throw new Error("Currency code is required");
      const result = await getPayrollContractGateway().createWorkspace({
        workspaceIdHex: await privateId("blackpay:workspace:v2", companyName),
        currencyIdHex: await privateId("blackpay:currency:v2", currencyCode.toUpperCase()),
        frequency,
      });
      await rememberPrivateWorkspaceCurrency(currencyCode);
      setNotice(`Blackpay v2 workspace transaction submitted: ${result.transactionId}`);
    });
  }

  async function addEmployee(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      let amount: bigint;
      try { amount = BigInt(salaryMinor); } catch { throw new Error("Salary must be an integer in the token's minor units"); }
      if (amount <= 0n || amount > ((1n << 64n) - 1n)) throw new Error("Salary is outside the supported range");
      if (!shieldedRecipient.trim()) throw new Error("Shielded recipient is required");
      const employeeIdHex = await privateId("blackpay:employee-id:v2", employeeId);
      const witness = {
        salaryMinor: amount,
        payoutCommitmentHex: await payoutCommitment(shieldedRecipient),
        payoutCoinPublicKeyHex: shieldedCoinPublicKeyHex(shieldedRecipient, config.network),
        saltHex: newPrivateSaltHex(),
      };
      putEmployeeWitness(employeeIdHex, witness);
      const result = await getPayrollContractGateway().addEmployee({ employeeIdHex, witness });
      setSalaryMinor("");
      setShieldedRecipient("");
      setNotice(`Private v2 employee commitment submitted: ${result.transactionId}. Salary and payout key remain private witness material.`);
    });
  }

  async function createPayRun(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      const tokenColorHex = assertTokenColorHex(payrollTokenType);
      const period = Number(payPeriod);
      if (!Number.isSafeInteger(period) || period <= 0 || period > 0xffffffff) throw new Error("Pay period must be a positive Uint32 value");
      const rawPayments = parsePaymentRows(paymentRows);
      const payments = await Promise.all(rawPayments.map(async (payment) => ({
        ...payment,
        employeeId: await privateId("blackpay:employee-id:v2", payment.employeeId),
      })));
      const settlementPayments: PrivateSettlementPayment[] = payments.map((payment) => ({
        employeeIdHex: payment.employeeId,
        amountMinor: payment.salaryMinor,
        payoutCoinPublicKeyHex: shieldedCoinPublicKeyHex(payment.shieldedRecipient, config.network),
        paymentSaltHex: newPrivateSaltHex(),
      }));
      const payRunIdHex = await privateId("blackpay:payrun-id:v2", payRunId);
      const result = await getPayrollContractGateway().createPayRun({ payRunIdHex, period, tokenColorHex, payments: settlementPayments });
      await recordPortalPayslipsForPayRun({ payRunIdHex, period, payments, currencyCode: currencyCode || undefined });
      setPreparedRuns((current) => ({ ...current, [payRunIdHex]: { payRunIdHex, payments } }));
      setNotice(`Private pay run created in ${result.transactionId}; ${result.registrationTransactionIds.length} exact payment claim(s) were registered against the committed payment root.`);
    });
  }

  async function approveCurrentPayRun() {
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      const payRunIdHex = await privateId("blackpay:payrun-id:v2", payRunId);
      const result = await getPayrollContractGateway().approvePayRun(payRunIdHex);
      setNotice(`Pay run approved: ${result.transactionId}. The contract verified every registered payment against the private committed payment root.`);
    });
  }

  async function fundCurrentPayRun() {
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      assertTokenColorHex(payrollTokenType);
      const payRunIdHex = await privateId("blackpay:payrun-id:v2", payRunId);
      const prepared = preparedRuns[payRunIdHex];
      if (!prepared) throw new Error("This v2 pay run is not available in the current encrypted employer session");
      const gateway = getPayrollContractGateway();
      let newlyFunded = 0;
      let alreadyFunded = 0;
      const txIds: string[] = [];
      for (const payment of prepared.payments) {
        const result = await gateway.fundPayRunPayment({ payRunIdHex, employeeIdHex: payment.employeeId });
        const wasAlreadyFunded = result.alreadyFunded === true || result.transactionId === "already-funded";
        if (wasAlreadyFunded) alreadyFunded += 1;
        else {
          newlyFunded += 1;
          if (result.transactionId) txIds.push(result.transactionId);
        }
      }
      setNotice(`Contract-bound payroll funding complete: ${newlyFunded} newly funded, ${alreadyFunded} already funded. ${txIds.length ? `Funding tx(s): ${txIds.join(", ")}. ` : ""}Export a fresh encrypted employee access package now; the employee must claim the funded salary from /employee.`);
    });
  }

  async function proveIncome(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      let thresholdMinor: bigint;
      try { thresholdMinor = BigInt(proofThreshold); } catch { throw new Error("Income threshold must be an integer in minor units"); }
      if (thresholdMinor <= 0n) throw new Error("Income threshold must be greater than zero");
      const employeeIdHex = await privateId("blackpay:employee-id:v2", proofEmployeeId);
      const witness = getEmployeeWitness(employeeIdHex);
      const result = await getPayrollContractGateway().proveIncomeAtLeast({ employeeIdHex, thresholdMinor, nonceHex: newPrivateSaltHex(), witness });
      setNotice(`Income proof ${result.proofIdHex} submitted in ${result.transactionId}. Exact salary was not disclosed.`);
    });
  }

  const liveReady = Boolean(connected && runtimeReady);
  const contractStatus = runtimeReady ? "V2 LIVE / JOINED" : connected ? "V2 DEPLOY REQUIRED" : "WAITING";

  return (
    <main className="shell">
      <header className="topbar">
        <div><div className="eyebrow">MIDNIGHT / CONFIDENTIAL PAYROLL V2</div><h1>BLACKPAY</h1></div>
        <div className="topActions">
          <a className="secondary" href="/employee">EMPLOYEE PORTAL</a>
          <span className="network">{config.network.toUpperCase()}</span>
          {connected ? <span className="walletConnected">{connected.name}</span> : wallets.length <= 1 ? (
            <button className="primary" disabled={busy} onClick={() => connect(wallets[0]?.id)}>CONNECT WALLET</button>
          ) : wallets.map((wallet) => <button className="secondary" disabled={busy} key={wallet.id} onClick={() => connect(wallet.id)}>{wallet.name}</button>)}
        </div>
      </header>

      <section className="hero">
        <p className="kicker">PRIVATE SALARIES. CONTRACT-BOUND SETTLEMENT.</p>
        <h2>Payroll without broadcasting payroll.</h2>
        <p className="heroCopy">Blackpay v2 commits each private employee payment, funds that exact claim into Midnight contract custody, and lets the bound employee wallet claim it once. There is no arbitrary transaction-hash finalization path.</p>
      </section>

      <section className="statusGrid">
        <article className="statusCard"><span>WALLET</span><strong>{connected ? "CONNECTED" : wallets.length ? "READY" : "NOT DETECTED"}</strong></article>
        <article className="statusCard"><span>NETWORK</span><strong>{config.network.toUpperCase()}</strong></article>
        <article className="statusCard"><span>CONTRACT</span><strong>{contractStatus}</strong></article>
        <article className="statusCard"><span>SETTLEMENT</span><strong>CLAIM BOUND</strong></article>
      </section>

      {(notice || failure) && <section className={failure ? "message error" : "message success"}>{failure || notice}</section>}
      {connected && !runtimeReady && <section className="message error">WALLET ONLY — NO BLACKPAY V2 RUNTIME IS ACTIVE. The legacy v1 contract cannot be upgraded in place. Open the runtime below and deploy a new Blackpay v2 contract. <a href="#midnight-runtime">OPEN V2 RUNTIME ↓</a></section>}

      <section className="workspaceGrid">
        <form className="panel" onSubmit={createWorkspace}>
          <div className="panelNumber">01</div><h3>Employer workspace</h3><p>Company and currency labels are hashed before the contract call.</p>
          <label>Company name<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company" /></label>
          <label>Currency / token label<input value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} placeholder="USDM" /></label>
          <label>Frequency<select value={frequency} onChange={(e) => setFrequency(e.target.value as PayrollFrequency)}><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select></label>
          <button className="primary full" disabled={busy || !liveReady}>CREATE WORKSPACE</button>
        </form>

        <form className="panel" onSubmit={addEmployee}>
          <div className="panelNumber">02</div><h3>Private employee</h3><p>Salary, full payout address, payout coin key, and salt stay private. Only their commitment is public.</p>
          <label>Employee reference<input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="Internal employee ID" /></label>
          <label>Salary in minor units<input inputMode="numeric" value={salaryMinor} onChange={(e) => setSalaryMinor(e.target.value)} placeholder="325000" /></label>
          <label>Shielded recipient<input value={shieldedRecipient} onChange={(e) => setShieldedRecipient(e.target.value)} placeholder="Midnight shielded address" /></label>
          <button className="primary full" disabled={busy || !liveReady}>COMMIT EMPLOYEE</button>
        </form>

        <form className="panel wide" onSubmit={createPayRun}>
          <div className="panelNumber">03</div><h3>Contract-bound confidential pay run</h3>
          <p>Each row becomes a private payment commitment. Approval is impossible until every expected claim is registered and the rolling claim root matches the private pay-run commitment.</p>
          <div className="twoCol">
            <label>Pay run reference<input value={payRunId} onChange={(e) => setPayRunId(e.target.value)} placeholder="2026-09" /></label>
            <label>Period number<input inputMode="numeric" value={payPeriod} onChange={(e) => setPayPeriod(e.target.value)} placeholder="202609" /></label>
          </div>
          <label>Payroll token (Lace shielded balance)
            <select value={payrollTokenType} onChange={(e) => setPayrollTokenType(e.target.value)}>
              <option value="">SELECT REAL SHIELDED TOKEN</option>
              {tokenBalances.map((entry) => <option value={entry.type} key={entry.type}>{shortToken(entry.type)} · {entry.balance.toString()}</option>)}
              {payrollTokenType && !tokenBalances.some((entry) => entry.type === payrollTokenType) && <option value={payrollTokenType}>{shortToken(payrollTokenType)} · CONFIGURED</option>}
            </select>
          </label>
          <label>Payments<textarea value={paymentRows} onChange={(e) => setPaymentRows(e.target.value)} rows={6} placeholder="employee-001 | 325000 | shielded-address" /></label>
          <div className="buttonRow">
            <button className="primary" disabled={busy || !liveReady || !payrollTokenType}>CREATE PAY RUN</button>
            <button className="secondary" type="button" disabled={busy || !liveReady} onClick={approveCurrentPayRun}>APPROVE</button>
            <button className="secondary" type="button" disabled={busy || !liveReady || !payrollTokenType} onClick={fundCurrentPayRun}>FUND CONTRACT CLAIMS</button>
          </div>
          <p>After funding, export a fresh employee access package. The employee claims the contract-held salary from the Employee Portal; the claim is fixed to the registered payout key and can settle only once.</p>
        </form>

        <form className="panel" onSubmit={proveIncome}>
          <div className="panelNumber">04</div><h3>Proof of income</h3><p>Prove salary ≥ threshold against the registered private record without disclosing the exact salary.</p>
          <label>Employee reference<input value={proofEmployeeId} onChange={(e) => setProofEmployeeId(e.target.value)} placeholder="Internal employee ID" /></label>
          <label>Threshold in minor units<input inputMode="numeric" value={proofThreshold} onChange={(e) => setProofThreshold(e.target.value)} placeholder="250000" /></label>
          <button className="primary full" disabled={busy || !liveReady}>GENERATE PROOF</button>
        </form>

        <article className="panel protocolPanel">
          <div className="panelNumber">05</div><h3>V2 settlement boundary</h3>
          <dl>
            <div><dt>Exact salary</dt><dd>PRIVATE</dd></div>
            <div><dt>Payout wallet</dt><dd>PRIVATE / COMMITTED</dd></div>
            <div><dt>Payment set</dt><dd>PRIVATE / ROOT COMMITTED</dd></div>
            <div><dt>Funding</dt><dd>CONTRACT CUSTODY</dd></div>
            <div><dt>Employee claim</dt><dd>ONE TIME</dd></div>
            <div><dt>Arbitrary tx finalize</dt><dd>REMOVED</dd></div>
          </dl>
        </article>
      </section>

      <footer><span>BLACKPAY / PROTOCOL V2</span><span>NO MOCK TRANSACTIONS · NO ARBITRARY SETTLEMENT FINALIZATION</span></footer>
    </main>
  );
}

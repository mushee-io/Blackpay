"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { PreviewRuntimeClientOnly } from "@/components/PreviewRuntimeClientOnly";
import { getMidnightPublicConfig } from "@/lib/midnight/network";
import {
  connectMidnightWallet,
  getConnectedMidnightWallet,
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

export type BlackpaySection = "dashboard" | "workspace" | "employees" | "pay-runs" | "proofs" | "runtime";

type PreparedPayRun = {
  payRunIdHex: string;
  payments: PrivatePayrollPayment[];
};

type ShieldedTokenBalance = {
  type: string;
  balance: bigint;
};

type PageMeta = {
  eyebrow: string;
  title: string;
  description: string;
};

const PAGE_META: Record<BlackpaySection, PageMeta> = {
  dashboard: {
    eyebrow: "Employer console",
    title: "Dashboard",
    description: "Private payroll operations, contract health and employee settlement in one controlled workspace.",
  },
  workspace: {
    eyebrow: "Foundation",
    title: "Workspace",
    description: "Configure the private payroll workspace and its operating cadence.",
  },
  employees: {
    eyebrow: "People",
    title: "Employees",
    description: "Register employees without publishing salary or payout information.",
  },
  "pay-runs": {
    eyebrow: "Payroll",
    title: "Pay runs",
    description: "Create, approve and fund exact contract-bound payroll claims.",
  },
  proofs: {
    eyebrow: "Verification",
    title: "Proofs",
    description: "Generate privacy-preserving income proofs without revealing exact compensation.",
  },
  runtime: {
    eyebrow: "Midnight infrastructure",
    title: "Runtime",
    description: "Deploy or join the canonical Blackpay v2 contract and manage encrypted recovery.",
  },
};

const NAV_PRIMARY: Array<{ section?: BlackpaySection; href: string; label: string }> = [
  { section: "dashboard", href: "/", label: "Dashboard" },
  { section: "workspace", href: "/workspace", label: "Workspace" },
  { section: "employees", href: "/employees", label: "Employees" },
  { section: "pay-runs", href: "/pay-runs", label: "Pay runs" },
  { section: "proofs", href: "/proofs", label: "Proofs" },
];

const NAV_PRIVATE = [
  { href: "/disclosures", label: "Disclosures" },
  { href: "/employee-access", label: "Employee access" },
  { href: "/audit", label: "Audit" },
  { href: "/employee", label: "Employee portal" },
];

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

export function BlackpayApp({ section = "dashboard" }: { section?: BlackpaySection }) {
  const config = useMemo(() => getMidnightPublicConfig(), []);
  const meta = PAGE_META[section];
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

  async function hydrateWallet(connection: ConnectedWallet) {
    setConnected(connection);
    const balances = await connection.api.getShieldedBalances();
    const supported: ShieldedTokenBalance[] = [];
    for (const [type, balance] of Object.entries(balances)) {
      try {
        const rawType = assertTokenColorHex(type);
        if (balance > 0n) supported.push({ type: rawType, balance });
      } catch {
        // Ignore wallet entries that are not raw shielded token types.
      }
    }
    setTokenBalances(supported);
    const configured = config.payrollTokenType ? (() => {
      try { return assertTokenColorHex(config.payrollTokenType); } catch { return ""; }
    })() : "";
    const selected = supported.find((entry) => entry.type === configured)?.type ?? supported[0]?.type ?? configured;
    setPayrollTokenType(selected || "");
  }

  useEffect(() => {
    setWallets(listMidnightWallets());
    setRuntimeReady(isPayrollContractGatewayReady());
    try {
      const existing = getConnectedMidnightWallet();
      void hydrateWallet(existing).catch(() => setConnected(null));
    } catch {
      // No active in-memory wallet session yet.
    }
    return subscribePayrollContractGateway(setRuntimeReady);
  }, []);

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
      await hydrateWallet(connection);
      setNotice(`Connected to ${connection.name} on ${config.network}.`);
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
      setNotice(`Workspace submitted: ${result.transactionId}`);
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
      setNotice(`Private employee commitment submitted: ${result.transactionId}`);
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
      setNotice(`Pay run created in ${result.transactionId}. ${result.registrationTransactionIds.length} exact payment claim(s) registered.`);
    });
  }

  async function approveCurrentPayRun() {
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      const payRunIdHex = await privateId("blackpay:payrun-id:v2", payRunId);
      const result = await getPayrollContractGateway().approvePayRun(payRunIdHex);
      setNotice(`Pay run approved: ${result.transactionId}`);
    });
  }

  async function fundCurrentPayRun() {
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      assertTokenColorHex(payrollTokenType);
      const payRunIdHex = await privateId("blackpay:payrun-id:v2", payRunId);
      const prepared = preparedRuns[payRunIdHex];
      if (!prepared) throw new Error("This pay run is not available in the current encrypted employer session");
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
      setNotice(`Funding complete: ${newlyFunded} newly funded, ${alreadyFunded} already funded.${txIds.length ? ` Transactions: ${txIds.join(", ")}.` : ""}`);
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
      setNotice(`Income proof ${result.proofIdHex} submitted in ${result.transactionId}.`);
    });
  }

  const liveReady = Boolean(connected && runtimeReady);
  const contractStatus = runtimeReady ? "Joined" : connected ? "Deployment required" : "Not connected";

  function renderDashboard() {
    return (
      <>
        <section className="executiveHero">
          <div>
            <span className="sectionKicker">Confidential payroll infrastructure</span>
            <h2>Private payroll.<br />Verifiable settlement.</h2>
            <p>Blackpay keeps compensation and payout data private while preserving auditable payroll state on Midnight.</p>
          </div>
          <div className="heroMetricBlock">
            <span>Protocol</span><strong>V2</strong><small>Contract-bound claims</small>
          </div>
        </section>

        <section className="statusGrid professionalStatus" aria-label="Blackpay status">
          <article className="statusCard"><span>Wallet</span><strong>{connected ? "Connected" : wallets.length ? "Available" : "Not detected"}</strong><small>Lace / Midnight</small></article>
          <article className="statusCard"><span>Contract</span><strong>{contractStatus}</strong><small>Protocol v2</small></article>
          <article className="statusCard"><span>Settlement</span><strong>Claim bound</strong><small>One-time employee claim</small></article>
          <article className="statusCard"><span>Network</span><strong>{config.network.toUpperCase()}</strong><small>Test environment</small></article>
        </section>

        <section className="dashboardSection">
          <div className="sectionHeading"><div><span className="sectionKicker">Operations</span><h3>Payroll workspace</h3></div><p>Each operational area now has its own dedicated workspace.</p></div>
          <div className="routeCardGrid">
            <Link className="routeCard" href="/workspace"><span>01</span><h4>Workspace</h4><p>Configure payroll identity, currency and cadence.</p><b>Open workspace →</b></Link>
            <Link className="routeCard" href="/employees"><span>02</span><h4>Employees</h4><p>Commit private employee salary and payout records.</p><b>Manage employees →</b></Link>
            <Link className="routeCard featured" href="/pay-runs"><span>03</span><h4>Pay runs</h4><p>Create, approve and fund contract-bound salary claims.</p><b>Open pay runs →</b></Link>
            <Link className="routeCard" href="/proofs"><span>04</span><h4>Proofs</h4><p>Generate income proofs without exposing compensation.</p><b>Open proofs →</b></Link>
          </div>
        </section>

        <section className="privacyStatement">
          <span className="sectionKicker">Privacy boundary</span>
          <h3>What payroll needs to prove — without publishing what payroll needs to protect.</h3>
          <div className="privacyRows">
            <div><span>Exact salary</span><strong>Private</strong></div>
            <div><span>Payout wallet</span><strong>Private / committed</strong></div>
            <div><span>Funding</span><strong>Contract custody</strong></div>
            <div><span>Employee claim</span><strong>One time</strong></div>
          </div>
        </section>
      </>
    );
  }

  function renderWorkspace() {
    return (
      <section className="singleWorkspace">
        <form className="panel primaryPanel" onSubmit={createWorkspace}>
          <div className="panelHeader"><div><span className="sectionKicker">Workspace configuration</span><h3>Employer workspace</h3></div><span className="securityTag">Hashed on submission</span></div>
          <p>Create the operating context for private payroll. Company and currency labels are hashed before the contract call.</p>
          <div className="formSection">
            <label>Company name<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company" /></label>
            <label>Currency / token label<input value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} placeholder="USDM" /></label>
            <label>Payroll frequency<select value={frequency} onChange={(e) => setFrequency(e.target.value as PayrollFrequency)}><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select></label>
          </div>
          <div className="actionBar"><span>Requires connected wallet + active v2 runtime.</span><button className="primary" disabled={busy || !liveReady}>Create workspace</button></div>
        </form>
      </section>
    );
  }

  function renderEmployees() {
    return (
      <section className="singleWorkspace">
        <form className="panel primaryPanel" onSubmit={addEmployee}>
          <div className="panelHeader"><div><span className="sectionKicker">Private registry</span><h3>Add employee</h3></div><span className="securityTag">Private witness</span></div>
          <p>Salary, full payout address, payout key and private salt stay off the public ledger. Only the employee commitment is published.</p>
          <div className="formSection">
            <label>Employee reference<input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="Internal employee ID" /></label>
            <label>Salary in minor units<input inputMode="numeric" value={salaryMinor} onChange={(e) => setSalaryMinor(e.target.value)} placeholder="325000" /></label>
            <label>Shielded recipient<input value={shieldedRecipient} onChange={(e) => setShieldedRecipient(e.target.value)} placeholder="Midnight shielded address" /></label>
          </div>
          <div className="actionBar"><span>No salary amount is written to public storage.</span><button className="primary" disabled={busy || !liveReady}>Commit employee</button></div>
        </form>
      </section>
    );
  }

  function renderPayRuns() {
    return (
      <section className="singleWorkspace">
        <form className="panel primaryPanel payRunPanel" onSubmit={createPayRun}>
          <div className="panelHeader"><div><span className="sectionKicker">Contract-bound settlement</span><h3>Confidential pay run</h3></div><span className="securityTag">Exact claim set</span></div>
          <p>Register the exact private payment set, approve the committed root, then fund contract custody for employee claim.</p>
          <div className="flowSteps professionalFlow" aria-label="Pay run lifecycle">
            <span><b>01</b>Create</span><i>→</i><span><b>02</b>Approve</span><i>→</i><span><b>03</b>Fund</span><i>→</i><span><b>04</b>Claim</span>
          </div>
          <div className="twoCol">
            <label>Pay run reference<input value={payRunId} onChange={(e) => setPayRunId(e.target.value)} placeholder="2026-09" /></label>
            <label>Period number<input inputMode="numeric" value={payPeriod} onChange={(e) => setPayPeriod(e.target.value)} placeholder="202609" /></label>
          </div>
          <label>Payroll token
            <select value={payrollTokenType} onChange={(e) => setPayrollTokenType(e.target.value)}>
              <option value="">Select shielded token</option>
              {tokenBalances.map((entry) => <option value={entry.type} key={entry.type}>{shortToken(entry.type)} · {entry.balance.toString()}</option>)}
              {payrollTokenType && !tokenBalances.some((entry) => entry.type === payrollTokenType) && <option value={payrollTokenType}>{shortToken(payrollTokenType)} · configured</option>}
            </select>
          </label>
          <label>Private payment rows<textarea value={paymentRows} onChange={(e) => setPaymentRows(e.target.value)} rows={7} placeholder="employee-001 | 325000 | shielded-address" /></label>
          <div className="actionBar multiAction"><span>Keep this page open through create → approve → fund so the private session remains active.</span><div><button className="primary" disabled={busy || !liveReady || !payrollTokenType}>Create pay run</button><button className="secondary" type="button" disabled={busy || !liveReady} onClick={approveCurrentPayRun}>Approve</button><button className="secondary" type="button" disabled={busy || !liveReady || !payrollTokenType} onClick={fundCurrentPayRun}>Fund claims</button></div></div>
        </form>
      </section>
    );
  }

  function renderProofs() {
    return (
      <section className="singleWorkspace">
        <form className="panel primaryPanel" onSubmit={proveIncome}>
          <div className="panelHeader"><div><span className="sectionKicker">Zero-knowledge verification</span><h3>Proof of income</h3></div><span className="securityTag">Salary hidden</span></div>
          <p>Prove that a private salary meets a requested threshold without revealing the salary itself.</p>
          <div className="formSection">
            <label>Employee reference<input value={proofEmployeeId} onChange={(e) => setProofEmployeeId(e.target.value)} placeholder="Internal employee ID" /></label>
            <label>Threshold in minor units<input inputMode="numeric" value={proofThreshold} onChange={(e) => setProofThreshold(e.target.value)} placeholder="250000" /></label>
          </div>
          <div className="actionBar"><span>The exact salary remains private.</span><button className="primary" disabled={busy || !liveReady}>Generate proof</button></div>
        </form>
      </section>
    );
  }

  function renderRuntime() {
    return <section className="runtimeWorkspace"><PreviewRuntimeClientOnly /></section>;
  }

  const body = section === "dashboard" ? renderDashboard() : section === "workspace" ? renderWorkspace() : section === "employees" ? renderEmployees() : section === "pay-runs" ? renderPayRuns() : section === "proofs" ? renderProofs() : renderRuntime();

  return (
    <main className="blackpayAppShell professionalShell">
      <aside className="appSidebar professionalSidebar">
        <Link className="brandLockup professionalBrand" href="/" aria-label="Blackpay dashboard">
          <span className="brandGlyph professionalGlyph" aria-hidden="true"><span /><span /></span>
          <span className="brandText">Blackpay<small>Protocol v2</small></span>
        </Link>

        <div className="sidebarGroup">
          <span className="sidebarLabel">Employer</span>
          <nav className="sidebarNav" aria-label="Employer navigation">
            {NAV_PRIMARY.map((item) => <Link key={item.href} className={item.section === section ? "active" : ""} href={item.href}>{item.label}</Link>)}
          </nav>
        </div>

        <div className="sidebarGroup">
          <span className="sidebarLabel">Private operations</span>
          <nav className="sidebarNav">
            {NAV_PRIVATE.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
          </nav>
        </div>

        <div className="sidebarGroup sidebarUtility">
          <span className="sidebarLabel">Infrastructure</span>
          <nav className="sidebarNav"><Link className={section === "runtime" ? "active" : ""} href="/runtime">Runtime & recovery</Link></nav>
        </div>

        <div className="sidebarWalletCard professionalWalletCard">
          <div><span className={connected ? "statusDot online" : "statusDot"} /><span>{connected ? connected.name : "Wallet disconnected"}</span></div>
          <strong>{runtimeReady ? "Runtime ready" : "Runtime inactive"}</strong>
          <small>{config.network.toUpperCase()} · TESTNET</small>
        </div>
      </aside>

      <section className="appMain professionalMain">
        <header className="appTopbar professionalTopbar">
          <div className="topbarTitle"><span className="eyebrow">{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div>
          <div className="topActions">
            <span className="network">{config.network.toUpperCase()}</span>
            {connected ? <span className="walletConnected">{connected.name}</span> : wallets.length <= 1 ? (
              <button className="primary compactButton" disabled={busy} onClick={() => connect(wallets[0]?.id)}>Connect wallet</button>
            ) : wallets.map((wallet) => <button className="secondary compactButton" disabled={busy} key={wallet.id} onClick={() => connect(wallet.id)}>{wallet.name}</button>)}
          </div>
        </header>

        {(notice || failure) && <section className={failure ? "message error" : "message success"}>{failure || notice}</section>}
        {connected && !runtimeReady && section !== "runtime" && <section className="message warning">Wallet connected, but no Blackpay v2 runtime is active. <Link href="/runtime">Open runtime →</Link></section>}

        <div className="pageCanvas">{body}</div>

        <footer className="polishedFooter">
          <div><span className="footerBrand">Blackpay</span><p>Confidential payroll on Midnight.</p></div>
          <div className="footerMeta"><span>Protocol v2</span><span>{config.network.toUpperCase()} testnet</span><span>Private salaries · Public proof</span></div>
        </footer>
      </section>
    </main>
  );
}

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
} from "@/lib/midnight/contract-client";
import {
  markPortalPayRunPaid,
  recordPortalPayslipsForPayRun,
  rememberPrivateWorkspaceCurrency,
} from "@/lib/midnight/live-runtime";
import { submitShieldedPayroll } from "@/lib/midnight/payments";
import {
  paymentsRoot,
  payoutCommitment,
  payrollTotal,
  sha256Hex,
  transactionCommitment,
} from "@/lib/payroll/commitments";
import { getEmployeeWitness, putEmployeeWitness, putPayRunWitness } from "@/lib/payroll/session-store";
import { newPrivateSaltHex } from "@/lib/payroll/validation";
import type { PayrollFrequency, PrivatePayrollPayment } from "@/lib/payroll/types";

type PreparedPayRun = {
  payRunIdHex: string;
  payments: PrivatePayrollPayment[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Blackpay error";
}

async function privateId(domain: string, value: string): Promise<string> {
  if (!value.trim()) throw new Error("Identifier is required");
  return sha256Hex(`${domain}:${value.trim()}`);
}

function parsePaymentRows(value: string): PrivatePayrollPayment[] {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

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
    if (salaryMinor <= 0n) throw new Error(`Payroll row ${index + 1} amount must be greater than zero`);
    return { employeeId, salaryMinor, shieldedRecipient };
  });
}

export function BlackpayApp() {
  const config = useMemo(() => getMidnightPublicConfig(), []);
  const [wallets, setWallets] = useState<AvailableWallet[]>([]);
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [failure, setFailure] = useState<string>("");
  const [preparedRuns, setPreparedRuns] = useState<Record<string, PreparedPayRun>>({});

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
      setNotice(`Blackpay live runtime active on ${config.network}. Payroll actions are enabled.`);
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
      setNotice(`Connected to ${connection.name} on ${config.network}.`);
    });
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      const gateway = getPayrollContractGateway();
      if (!companyName.trim()) throw new Error("Company name is required");
      if (!currencyCode.trim()) throw new Error("Currency code is required");
      const workspaceIdHex = await privateId("blackpay:workspace:v1", companyName);
      const currencyIdHex = await privateId("blackpay:currency:v1", currencyCode.toUpperCase());
      const result = await gateway.createWorkspace({ workspaceIdHex, currencyIdHex, frequency });
      await rememberPrivateWorkspaceCurrency(currencyCode);
      setNotice(`Workspace transaction submitted: ${result.transactionId}`);
    });
  }

  async function addEmployee(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      let amount: bigint;
      try {
        amount = BigInt(salaryMinor);
      } catch {
        throw new Error("Salary must be an integer in the token's minor units");
      }
      if (amount <= 0n) throw new Error("Salary must be greater than zero");
      if (!shieldedRecipient.trim()) throw new Error("Shielded recipient is required");

      const employeeIdHex = await privateId("blackpay:employee-id:v1", employeeId);
      const payoutCommitmentHex = await payoutCommitment(shieldedRecipient);
      const witness = {
        salaryMinor: amount,
        payoutCommitmentHex,
        saltHex: newPrivateSaltHex(),
      };

      putEmployeeWitness(employeeIdHex, witness);
      const result = await getPayrollContractGateway().addEmployee({ employeeIdHex, witness });
      setSalaryMinor("");
      setShieldedRecipient("");
      setNotice(`Private employee commitment submitted: ${result.transactionId}. The payout commitment is now the employee wallet binding for access packages.`);
    });
  }

  async function createPayRun(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      const period = Number(payPeriod);
      if (!Number.isSafeInteger(period) || period <= 0) throw new Error("Pay period must be a positive integer");
      const rawPayments = parsePaymentRows(paymentRows);
      const payments = await Promise.all(
        rawPayments.map(async (payment) => ({
          ...payment,
          employeeId: await privateId("blackpay:employee-id:v1", payment.employeeId),
        })),
      );
      const payRunIdHex = await privateId("blackpay:payrun-id:v1", payRunId);
      const saltHex = newPrivateSaltHex();
      const privateInput = { payRunId: payRunIdHex, period, payments, saltHex };
      const witness = {
        totalPayrollMinor: payrollTotal(privateInput),
        paymentsRootHex: await paymentsRoot(privateInput),
        saltHex,
      };

      putPayRunWitness(payRunIdHex, witness);
      const result = await getPayrollContractGateway().createPayRun({
        payRunIdHex,
        period,
        employeeCount: payments.length,
        witness,
      });
      await recordPortalPayslipsForPayRun({
        payRunIdHex,
        period,
        payments,
        currencyCode: currencyCode || undefined,
      });
      setPreparedRuns((current) => ({ ...current, [payRunIdHex]: { payRunIdHex, payments } }));
      setNotice(`Private pay run created: ${result.transactionId}. Employee payslips were generated in encrypted private state.`);
    });
  }

  async function approveCurrentPayRun() {
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      const payRunIdHex = await privateId("blackpay:payrun-id:v1", payRunId);
      const result = await getPayrollContractGateway().approvePayRun(payRunIdHex);
      setNotice(`Pay run approved: ${result.transactionId}. Matching private payslips are now APPROVED.`);
    });
  }

  async function executeCurrentPayRun() {
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      if (!config.payrollTokenType) throw new Error("A real Preview payroll token type is not configured yet");
      const payRunIdHex = await privateId("blackpay:payrun-id:v1", payRunId);
      const prepared = preparedRuns[payRunIdHex];
      if (!prepared) throw new Error("This pay run is not available in the current private session");

      const paymentResult = await submitShieldedPayroll({
        wallet: connected.api,
        tokenType: config.payrollTokenType,
        payments: prepared.payments,
      });
      const txCommitmentHex = await transactionCommitment(paymentResult.transactionId);

      try {
        const finalization = await getPayrollContractGateway().finalizePayRun({
          payRunIdHex,
          transactionCommitmentHex: txCommitmentHex,
        });
        await markPortalPayRunPaid(payRunIdHex, paymentResult.transactionId);
        setNotice(`Payroll paid ${paymentResult.transactionId}; run finalized ${finalization.transactionId}. Employee payslips are now PAID.`);
      } catch (error) {
        throw new Error(
          `Payroll payment was submitted as ${paymentResult.transactionId}, but pay-run finalization failed: ${errorMessage(error)}`,
        );
      }
    });
  }

  async function proveIncome(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!connected) throw new Error("Connect a Midnight wallet first");
      let thresholdMinor: bigint;
      try {
        thresholdMinor = BigInt(proofThreshold);
      } catch {
        throw new Error("Income threshold must be an integer in minor units");
      }
      if (thresholdMinor <= 0n) throw new Error("Income threshold must be greater than zero");

      const employeeIdHex = await privateId("blackpay:employee-id:v1", proofEmployeeId);
      const witness = getEmployeeWitness(employeeIdHex);
      const result = await getPayrollContractGateway().proveIncomeAtLeast({
        employeeIdHex,
        thresholdMinor,
        nonceHex: newPrivateSaltHex(),
        witness,
      });
      setNotice(`Income proof ${result.proofIdHex} submitted in ${result.transactionId}. Exact salary was not disclosed.`);
    });
  }

  const liveReady = Boolean(connected && runtimeReady);
  const contractStatus = runtimeReady ? "LIVE / JOINED" : connected ? "DEPLOY REQUIRED" : "WAITING";

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">MIDNIGHT / CONFIDENTIAL PAYROLL</div>
          <h1>BLACKPAY</h1>
        </div>
        <div className="topActions">
          <a className="secondary" href="/employee">EMPLOYEE PORTAL</a>
          <span className="network">{config.network.toUpperCase()}</span>
          {connected ? (
            <span className="walletConnected">{connected.name}</span>
          ) : wallets.length <= 1 ? (
            <button className="primary" disabled={busy} onClick={() => connect(wallets[0]?.id)}>
              CONNECT WALLET
            </button>
          ) : (
            wallets.map((wallet) => (
              <button className="secondary" disabled={busy} key={wallet.id} onClick={() => connect(wallet.id)}>
                {wallet.name}
              </button>
            ))
          )}
        </div>
      </header>

      <section className="hero">
        <p className="kicker">PRIVATE SALARIES. PUBLIC PROOF.</p>
        <h2>Payroll without broadcasting payroll.</h2>
        <p className="heroCopy">
          Employers commit private salary records, execute shielded pay runs, and let employees prove income thresholds without revealing exact compensation.
        </p>
      </section>

      <section className="statusGrid">
        <article className="statusCard">
          <span>WALLET</span>
          <strong>{connected ? "CONNECTED" : wallets.length ? "READY" : "NOT DETECTED"}</strong>
        </article>
        <article className="statusCard">
          <span>NETWORK</span>
          <strong>{config.network.toUpperCase()}</strong>
        </article>
        <article className="statusCard">
          <span>CONTRACT</span>
          <strong>{contractStatus}</strong>
        </article>
        <article className="statusCard">
          <span>PRIVACY MODE</span>
          <strong>FAIL CLOSED</strong>
        </article>
      </section>

      {(notice || failure) && (
        <section className={failure ? "message error" : "message success"}>{failure || notice}</section>
      )}

      {connected && !runtimeReady && (
        <section className="message error">
          WALLET ONLY — NO CONTRACT RUNTIME IS ACTIVE. Payroll buttons are intentionally locked. Go to the Midnight Preview runtime below, enter a private-state password, then deploy a new Blackpay contract or join an existing verified contract. <a href="#midnight-runtime">OPEN LIVE RUNTIME ↓</a>
        </section>
      )}

      <section className="workspaceGrid">
        <form className="panel" onSubmit={createWorkspace}>
          <div className="panelNumber">01</div>
          <h3>Employer workspace</h3>
          <p>Company and currency labels are hashed before the contract call.</p>
          <label>Company name<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company" /></label>
          <label>Currency / token label<input value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} placeholder="USDM" /></label>
          <label>Frequency<select value={frequency} onChange={(e) => setFrequency(e.target.value as PayrollFrequency)}><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select></label>
          <button className="primary full" disabled={busy || !liveReady}>CREATE WORKSPACE</button>
        </form>

        <form className="panel" onSubmit={addEmployee}>
          <div className="panelNumber">02</div>
          <h3>Private employee</h3>
          <p>Salary, payout destination, and salt remain private witness material. The payout commitment also binds the employee portal to the correct Lace wallet.</p>
          <label>Employee reference<input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="Internal employee ID" /></label>
          <label>Salary in minor units<input inputMode="numeric" value={salaryMinor} onChange={(e) => setSalaryMinor(e.target.value)} placeholder="325000" /></label>
          <label>Shielded recipient<input value={shieldedRecipient} onChange={(e) => setShieldedRecipient(e.target.value)} placeholder="Midnight shielded address" /></label>
          <button className="primary full" disabled={busy || !liveReady}>COMMIT EMPLOYEE</button>
        </form>

        <form className="panel wide" onSubmit={createPayRun}>
          <div className="panelNumber">03</div>
          <h3>Confidential pay run</h3>
          <p>One row per employee. Private amounts and recipients create the pay-run commitment and the employee's encrypted payslip record.</p>
          <div className="twoCol">
            <label>Pay run reference<input value={payRunId} onChange={(e) => setPayRunId(e.target.value)} placeholder="2026-09" /></label>
            <label>Period number<input inputMode="numeric" value={payPeriod} onChange={(e) => setPayPeriod(e.target.value)} placeholder="202609" /></label>
          </div>
          <label>Payments<textarea value={paymentRows} onChange={(e) => setPaymentRows(e.target.value)} rows={6} placeholder="employee-001 | 325000 | shielded-address" /></label>
          <div className="buttonRow">
            <button className="primary" disabled={busy || !liveReady}>CREATE PAY RUN</button>
            <button className="secondary" type="button" disabled={busy || !liveReady} onClick={approveCurrentPayRun}>APPROVE</button>
            <button className="secondary" type="button" disabled={busy || !liveReady || !config.payrollTokenType} onClick={executeCurrentPayRun}>EXECUTE SHIELDED PAYROLL</button>
          </div>
        </form>

        <form className="panel" onSubmit={proveIncome}>
          <div className="panelNumber">04</div>
          <h3>Proof of income</h3>
          <p>Prove salary ≥ threshold against the registered private record. The exact salary is not disclosed.</p>
          <label>Employee reference<input value={proofEmployeeId} onChange={(e) => setProofEmployeeId(e.target.value)} placeholder="Internal employee ID" /></label>
          <label>Threshold in minor units<input inputMode="numeric" value={proofThreshold} onChange={(e) => setProofThreshold(e.target.value)} placeholder="250000" /></label>
          <button className="primary full" disabled={busy || !liveReady}>GENERATE PROOF</button>
        </form>

        <article className="panel protocolPanel">
          <div className="panelNumber">05</div>
          <h3>Privacy boundary</h3>
          <dl>
            <div><dt>Exact salary</dt><dd>PRIVATE</dd></div>
            <div><dt>Shielded recipient</dt><dd>PRIVATE</dd></div>
            <div><dt>Employee commitment</dt><dd>PUBLIC</dd></div>
            <div><dt>Pay-run commitment</dt><dd>PUBLIC</dd></div>
            <div><dt>Income threshold</dt><dd>DISCLOSED</dd></div>
            <div><dt>Proof result</dt><dd>VERIFIABLE</dd></div>
          </dl>
        </article>
      </section>

      <footer>
        <span>BLACKPAY / LIVE EMPLOYER</span>
        <span>NO MOCK TRANSACTIONS · NO FAKE PROOFS</span>
      </footer>
    </main>
  );
}

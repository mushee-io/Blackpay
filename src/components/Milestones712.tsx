"use client";

import { FormEvent, useMemo, useState } from "react";
import { buildPublicAuditBundle } from "@/lib/compliance/audit-bundle";
import { getPayrollContractGateway } from "@/lib/midnight/contract-client";
import { getMidnightPublicConfig } from "@/lib/midnight/network";
import { sha256Hex } from "@/lib/payroll/commitments";
import {
  getEmployeeWitness,
  listPrivatePayslips,
  putPrivatePayslip,
} from "@/lib/payroll/session-store";
import type { PrivatePayslip } from "@/lib/payroll/types";
import { newPrivateSaltHex } from "@/lib/payroll/validation";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Blackpay error";
}

async function privateId(domain: string, value: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Identifier is required");
  return sha256Hex(`${domain}:${trimmed}`);
}

function splitRefs(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toFutureEpochSeconds(value: string): bigint {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error("Choose a valid disclosure expiry");
  if (ms <= Date.now()) throw new Error("Disclosure expiry must be in the future");
  return BigInt(Math.floor(ms / 1000));
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

export function Milestones712() {
  const config = useMemo(() => getMidnightPublicConfig(), []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");

  const [employeeRef, setEmployeeRef] = useState("");
  const [verifierRef, setVerifierRef] = useState("");
  const [thresholdMinor, setThresholdMinor] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [lastDisclosure, setLastDisclosure] = useState<{ id: string; employeeIdHex: string } | null>(null);

  const [payslipEmployeeRef, setPayslipEmployeeRef] = useState("");
  const [payslipRunRef, setPayslipRunRef] = useState("");
  const [payslipPeriod, setPayslipPeriod] = useState("");
  const [payslipGross, setPayslipGross] = useState("");
  const [payslipNet, setPayslipNet] = useState("");
  const [payslipCurrency, setPayslipCurrency] = useState("");
  const [payslipTx, setPayslipTx] = useState("");
  const [payslips, setPayslips] = useState<PrivatePayslip[]>([]);

  const [proofRefs, setProofRefs] = useState("");
  const [disclosureRefs, setDisclosureRefs] = useState("");
  const [transactionRefs, setTransactionRefs] = useState("");
  const [auditPreview, setAuditPreview] = useState("");

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

  async function createIncomeDisclosure(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const employeeIdHex = await privateId("blackpay:employee-id:v1", employeeRef);
      const verifierIdHex = await privateId("blackpay:verifier:v1", verifierRef);
      const witness = getEmployeeWitness(employeeIdHex);
      const result = await getPayrollContractGateway().createIncomeDisclosure({
        employeeIdHex,
        thresholdMinor: parsePositiveBigInt(thresholdMinor, "Income threshold"),
        verifierIdHex,
        expiresAt: toFutureEpochSeconds(expiresAt),
        nonceHex: newPrivateSaltHex(),
        witness,
      });
      setLastDisclosure({ id: result.disclosureIdHex, employeeIdHex });
      setNotice(`Scoped income disclosure created: ${result.disclosureIdHex} in ${result.transactionId}.`);
    });
  }

  async function createEmploymentDisclosure() {
    await run(async () => {
      const employeeIdHex = await privateId("blackpay:employee-id:v1", employeeRef);
      const verifierIdHex = await privateId("blackpay:verifier:v1", verifierRef);
      const witness = getEmployeeWitness(employeeIdHex);
      const result = await getPayrollContractGateway().createEmploymentDisclosure({
        employeeIdHex,
        verifierIdHex,
        expiresAt: toFutureEpochSeconds(expiresAt),
        nonceHex: newPrivateSaltHex(),
        witness,
      });
      setLastDisclosure({ id: result.disclosureIdHex, employeeIdHex });
      setNotice(`Scoped employment disclosure created: ${result.disclosureIdHex} in ${result.transactionId}.`);
    });
  }

  async function revokeLastDisclosure() {
    await run(async () => {
      if (!lastDisclosure) throw new Error("No disclosure has been created in this session");
      const witness = getEmployeeWitness(lastDisclosure.employeeIdHex);
      const result = await getPayrollContractGateway().revokeDisclosure({
        employeeIdHex: lastDisclosure.employeeIdHex,
        disclosureIdHex: lastDisclosure.id,
        witness,
      });
      setNotice(`Disclosure revoked in ${result.transactionId}.`);
      setLastDisclosure(null);
    });
  }

  async function issuePrivatePayslip(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const employeeIdHex = await privateId("blackpay:employee-id:v1", payslipEmployeeRef);
      const payRunIdHex = await privateId("blackpay:payrun-id:v1", payslipRunRef);
      const period = Number(payslipPeriod);
      if (!Number.isSafeInteger(period) || period <= 0) throw new Error("Payslip period must be a positive integer");
      const grossMinor = parsePositiveBigInt(payslipGross, "Gross pay");
      const netMinor = parsePositiveBigInt(payslipNet, "Net pay");
      if (netMinor > grossMinor) throw new Error("Net pay cannot exceed gross pay");
      if (!payslipCurrency.trim()) throw new Error("Currency code is required");
      if (!payslipTx.trim()) throw new Error("A real settlement transaction ID is required");

      putPrivatePayslip({
        employeeIdHex,
        payRunIdHex,
        period,
        grossMinor,
        netMinor,
        currencyCode: payslipCurrency.trim().toUpperCase(),
        paymentTransactionId: payslipTx.trim(),
        status: "submitted",
        createdAt: Date.now(),
      });
      setPayslips(listPrivatePayslips(employeeIdHex));
      setNotice("Private payslip stored in volatile session memory. No payroll amount was written to public storage.");
    });
  }

  async function loadPrivatePayslips() {
    await run(async () => {
      const employeeIdHex = await privateId("blackpay:employee-id:v1", payslipEmployeeRef);
      setPayslips(listPrivatePayslips(employeeIdHex));
      setNotice("Private payslip view refreshed from this browser session.");
    });
  }

  async function buildAudit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const bundle = buildPublicAuditBundle({
        network: config.network,
        contractAddress: config.contractAddress,
        proofIds: splitRefs(proofRefs),
        disclosureIds: splitRefs(disclosureRefs),
        transactionCommitments: splitRefs(transactionRefs),
      });
      setAuditPreview(JSON.stringify(bundle, null, 2));
      setNotice("Redacted audit bundle created without private payroll fields.");
    });
  }

  return (
    <section className="shell">
      <div className="eyebrow">BLACKPAY / MILESTONES 7–12</div>
      <h2>Disclosure, employee access, compliance, and integrations.</h2>

      <nav className="buttonRow" aria-label="Blackpay product areas">
        <span className="network">OVERVIEW</span>
        <span className="network">PEOPLE</span>
        <span className="network">PAYRUNS</span>
        <span className="network">PROOFS</span>
        <span className="network">EMPLOYEE</span>
        <span className="network">AUDIT</span>
        <span className="network">API</span>
      </nav>

      <section className="statusGrid">
        <article className="statusCard"><span>M7</span><strong>SELECTIVE DISCLOSURE</strong></article>
        <article className="statusCard"><span>M8</span><strong>EMPLOYER CONSOLE</strong></article>
        <article className="statusCard"><span>M9</span><strong>EMPLOYEE PORTAL</strong></article>
        <article className="statusCard"><span>M10–12</span><strong>RELEASE / AUDIT / SDK</strong></article>
      </section>

      {(notice || failure) && (
        <section className={failure ? "message error" : "message success"}>{failure || notice}</section>
      )}

      <section className="workspaceGrid">
        <form className="panel wide" onSubmit={createIncomeDisclosure}>
          <div className="panelNumber">07</div>
          <h3>Selective disclosure</h3>
          <p>Bind one verified fact to one verifier and an explicit expiry. Exact salary stays private.</p>
          <div className="twoCol">
            <label>Employee reference<input value={employeeRef} onChange={(e) => setEmployeeRef(e.target.value)} placeholder="employee-001" /></label>
            <label>Verifier reference<input value={verifierRef} onChange={(e) => setVerifierRef(e.target.value)} placeholder="landlord-or-lender" /></label>
          </div>
          <div className="twoCol">
            <label>Income threshold in minor units<input inputMode="numeric" value={thresholdMinor} onChange={(e) => setThresholdMinor(e.target.value)} placeholder="250000" /></label>
            <label>Expires at<input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
          </div>
          <div className="buttonRow">
            <button className="primary" disabled={busy}>PROVE INCOME TO VERIFIER</button>
            <button className="secondary" type="button" disabled={busy} onClick={createEmploymentDisclosure}>PROVE ACTIVE EMPLOYMENT</button>
            <button className="secondary" type="button" disabled={busy || !lastDisclosure} onClick={revokeLastDisclosure}>REVOKE LAST DISCLOSURE</button>
          </div>
          {lastDisclosure && <p>Last disclosure: <code>{lastDisclosure.id}</code></p>}
        </form>

        <article className="panel">
          <div className="panelNumber">08</div>
          <h3>Employer dashboard</h3>
          <p>The employer surface now spans workspace, people, pay runs, proofs, disclosure, audit, and release readiness.</p>
          <dl>
            <div><dt>Workspace</dt><dd>ACTIVE FLOW</dd></div>
            <div><dt>Private employees</dt><dd>COMMITMENT BASED</dd></div>
            <div><dt>Pay runs</dt><dd>3-STATE LIFECYCLE</dd></div>
            <div><dt>Proofs</dt><dd>SCOPED</dd></div>
            <div><dt>Contract</dt><dd>{config.contractAddress ? "CONFIGURED" : "DEPLOY REQUIRED"}</dd></div>
          </dl>
        </article>

        <form className="panel" onSubmit={issuePrivatePayslip}>
          <div className="panelNumber">09</div>
          <h3>Employee portal / payslip</h3>
          <p>Payslips live only in volatile private session memory until encrypted persistence is wired.</p>
          <label>Employee reference<input value={payslipEmployeeRef} onChange={(e) => setPayslipEmployeeRef(e.target.value)} placeholder="employee-001" /></label>
          <label>Pay run reference<input value={payslipRunRef} onChange={(e) => setPayslipRunRef(e.target.value)} placeholder="2026-09" /></label>
          <div className="twoCol">
            <label>Period<input inputMode="numeric" value={payslipPeriod} onChange={(e) => setPayslipPeriod(e.target.value)} placeholder="202609" /></label>
            <label>Currency<input value={payslipCurrency} onChange={(e) => setPayslipCurrency(e.target.value)} placeholder="USDM" /></label>
          </div>
          <div className="twoCol">
            <label>Gross minor units<input inputMode="numeric" value={payslipGross} onChange={(e) => setPayslipGross(e.target.value)} placeholder="325000" /></label>
            <label>Net minor units<input inputMode="numeric" value={payslipNet} onChange={(e) => setPayslipNet(e.target.value)} placeholder="325000" /></label>
          </div>
          <label>Settlement transaction ID<input value={payslipTx} onChange={(e) => setPayslipTx(e.target.value)} placeholder="Real Midnight transaction ID" /></label>
          <div className="buttonRow">
            <button className="primary" disabled={busy}>STORE PRIVATE PAYSLIP</button>
            <button className="secondary" type="button" disabled={busy} onClick={loadPrivatePayslips}>REFRESH MY PAYSLIPS</button>
          </div>
          {payslips.map((payslip) => (
            <article className="statusCard" key={`${payslip.payRunIdHex}:${payslip.paymentTransactionId}`}>
              <span>PERIOD {payslip.period}</span>
              <strong>{payslip.netMinor.toString()} {payslip.currencyCode}</strong>
              <p>{payslip.status.toUpperCase()} · gross {payslip.grossMinor.toString()}</p>
            </article>
          ))}
        </form>

        <article className="panel">
          <div className="panelNumber">10</div>
          <h3>Security / live release gate</h3>
          <p>Production status remains fail-closed until contract artifacts, Preview services, contract address, and build checks all pass.</p>
          <dl>
            <div><dt>Compact target</dt><dd>0.31.1</dd></div>
            <div><dt>Ledger</dt><dd>8.1.0</dd></div>
            <div><dt>Proof server</dt><dd>8.1.0</dd></div>
            <div><dt>Live command</dt><dd>npm run live:verify</dd></div>
          </dl>
        </article>

        <form className="panel wide" onSubmit={buildAudit}>
          <div className="panelNumber">11</div>
          <h3>Compliance / audit bundle</h3>
          <p>Export only public proof references and commitments. Salary, payout destinations, salts, and witnesses are structurally excluded.</p>
          <label>Proof IDs<textarea rows={3} value={proofRefs} onChange={(e) => setProofRefs(e.target.value)} placeholder="one 32-byte hex proof ID per line" /></label>
          <label>Disclosure IDs<textarea rows={3} value={disclosureRefs} onChange={(e) => setDisclosureRefs(e.target.value)} placeholder="one 32-byte hex disclosure ID per line" /></label>
          <label>Settlement commitments<textarea rows={3} value={transactionRefs} onChange={(e) => setTransactionRefs(e.target.value)} placeholder="one 32-byte hex commitment per line" /></label>
          <button className="primary" disabled={busy}>BUILD REDACTED AUDIT BUNDLE</button>
          {auditPreview && <pre>{auditPreview}</pre>}
        </form>

        <article className="panel">
          <div className="panelNumber">12</div>
          <h3>API / SDK integrations</h3>
          <p>Partners get a typed SDK façade over the real Midnight gateway plus a public-safe readiness endpoint.</p>
          <dl>
            <div><dt>SDK</dt><dd>src/lib/sdk/blackpay.ts</dd></div>
            <div><dt>Status API</dt><dd>/api/v1/status</dd></div>
            <div><dt>Private fallback</dt><dd>NONE</dd></div>
            <div><dt>Network</dt><dd>{config.network.toUpperCase()}</dd></div>
          </dl>
        </article>
      </section>

      <footer>
        <span>BLACKPAY / MILESTONES 7–12</span>
        <span>PRIVATE BY DEFAULT · DISCLOSE BY PROOF</span>
      </footer>
    </section>
  );
}

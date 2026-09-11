"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { buildPublicAuditBundle } from "@/lib/compliance/audit-bundle";
import { getPayrollContractGateway } from "@/lib/midnight/contract-client";
import { exportEmployeeAccessPackage, issuePortalPayslip } from "@/lib/midnight/live-runtime";
import { getMidnightPublicConfig } from "@/lib/midnight/network";
import { sha256Hex } from "@/lib/payroll/commitments";
import { getEmployeeWitness } from "@/lib/payroll/session-store";
import { newPrivateSaltHex } from "@/lib/payroll/validation";

export type AdvancedSection = "disclosures" | "employee-access" | "audit";

const META: Record<AdvancedSection, { eyebrow: string; title: string; description: string }> = {
  disclosures: {
    eyebrow: "Selective disclosure",
    title: "Disclosures",
    description: "Share only the verified fact a verifier needs — not the underlying payroll record.",
  },
  "employee-access": {
    eyebrow: "Private delivery",
    title: "Employee access",
    description: "Issue private payslips and export wallet-bound encrypted access packages.",
  },
  audit: {
    eyebrow: "Compliance",
    title: "Audit",
    description: "Build redacted public audit bundles without exposing payroll secrets.",
  },
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Blackpay error";
}

async function privateId(domain: string, value: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Identifier is required");
  return sha256Hex(`${domain}:${trimmed}`);
}

function splitRefs(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
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

function saveJsonFile(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Milestones712({ section = "disclosures" }: { section?: AdvancedSection }) {
  const config = useMemo(() => getMidnightPublicConfig(), []);
  const meta = META[section];
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
  const [employeeAccessPassword, setEmployeeAccessPassword] = useState("");

  const [proofRefs, setProofRefs] = useState("");
  const [disclosureRefs, setDisclosureRefs] = useState("");
  const [transactionRefs, setTransactionRefs] = useState("");
  const [auditPreview, setAuditPreview] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    setFailure("");
    try { await action(); } catch (error) { setFailure(message(error)); } finally { setBusy(false); }
  }

  async function createIncomeDisclosure(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const employeeIdHex = await privateId("blackpay:employee-id:v2", employeeRef);
      const verifierIdHex = await privateId("blackpay:verifier:v2", verifierRef);
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
      setNotice(`Scoped income disclosure created: ${result.disclosureIdHex}`);
    });
  }

  async function createEmploymentDisclosure() {
    await run(async () => {
      const employeeIdHex = await privateId("blackpay:employee-id:v2", employeeRef);
      const verifierIdHex = await privateId("blackpay:verifier:v2", verifierRef);
      const witness = getEmployeeWitness(employeeIdHex);
      const result = await getPayrollContractGateway().createEmploymentDisclosure({
        employeeIdHex,
        verifierIdHex,
        expiresAt: toFutureEpochSeconds(expiresAt),
        nonceHex: newPrivateSaltHex(),
        witness,
      });
      setLastDisclosure({ id: result.disclosureIdHex, employeeIdHex });
      setNotice(`Scoped employment disclosure created: ${result.disclosureIdHex}`);
    });
  }

  async function revokeLastDisclosure() {
    await run(async () => {
      if (!lastDisclosure) throw new Error("No disclosure has been created in this session");
      const witness = getEmployeeWitness(lastDisclosure.employeeIdHex);
      const result = await getPayrollContractGateway().revokeDisclosure({ employeeIdHex: lastDisclosure.employeeIdHex, disclosureIdHex: lastDisclosure.id, witness });
      setNotice(`Disclosure revoked in ${result.transactionId}.`);
      setLastDisclosure(null);
    });
  }

  async function issuePrivatePayslip(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const employeeIdHex = await privateId("blackpay:employee-id:v2", payslipEmployeeRef);
      const payRunIdHex = await privateId("blackpay:payrun-id:v2", payslipRunRef);
      const period = Number(payslipPeriod);
      if (!Number.isSafeInteger(period) || period <= 0) throw new Error("Payslip period must be a positive integer");
      const grossMinor = parsePositiveBigInt(payslipGross, "Gross pay");
      const netMinor = parsePositiveBigInt(payslipNet, "Net pay");
      if (netMinor > grossMinor) throw new Error("Net pay cannot exceed gross pay");
      if (!payslipCurrency.trim()) throw new Error("Currency code is required");
      const payslip = await issuePortalPayslip({
        employeeIdHex,
        payRunIdHex,
        period,
        grossMinor,
        netMinor,
        currencyCode: payslipCurrency.trim().toUpperCase(),
        ...(payslipTx.trim() ? { paymentTransactionId: payslipTx.trim() } : {}),
      });
      setNotice(`Encrypted employee payslip saved as ${payslip.status.toUpperCase()}.`);
    });
  }

  async function exportEmployeeAccess() {
    await run(async () => {
      const employeeIdHex = await privateId("blackpay:employee-id:v2", payslipEmployeeRef);
      if (!employeeAccessPassword) throw new Error("Enter a strong employee access package password");
      const envelope = await exportEmployeeAccessPackage({ employeeIdHex, accessPassword: employeeAccessPassword });
      saveJsonFile(`blackpay-v2-employee-${employeeIdHex.slice(0, 12)}-access-v3.json`, envelope);
      setEmployeeAccessPassword("");
      setNotice("Fresh v3 employee access package exported. Share the JSON and password through separate secure channels.");
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

  const primaryNav = [
    ["/", "Dashboard"], ["/workspace", "Workspace"], ["/employees", "Employees"], ["/pay-runs", "Pay runs"], ["/proofs", "Proofs"],
  ];
  const privateNav: Array<[string, string, AdvancedSection?]> = [
    ["/disclosures", "Disclosures", "disclosures"], ["/employee-access", "Employee access", "employee-access"], ["/audit", "Audit", "audit"], ["/employee", "Employee portal"],
  ];

  return (
    <main className="blackpayAppShell professionalShell">
      <aside className="appSidebar professionalSidebar">
        <Link className="brandLockup professionalBrand" href="/"><span className="brandGlyph professionalGlyph" aria-hidden="true"><span /><span /></span><span className="brandText">Blackpay<small>Protocol v2</small></span></Link>
        <div className="sidebarGroup"><span className="sidebarLabel">Employer</span><nav className="sidebarNav">{primaryNav.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</nav></div>
        <div className="sidebarGroup"><span className="sidebarLabel">Private operations</span><nav className="sidebarNav">{privateNav.map(([href, label, target]) => <Link key={href} className={target === section ? "active" : ""} href={href}>{label}</Link>)}</nav></div>
        <div className="sidebarGroup sidebarUtility"><span className="sidebarLabel">Infrastructure</span><nav className="sidebarNav"><Link href="/runtime">Runtime & recovery</Link></nav></div>
        <div className="sidebarWalletCard professionalWalletCard"><div><span className="statusDot online" /><span>Private operations</span></div><strong>Fail closed</strong><small>{config.network.toUpperCase()} · TESTNET</small></div>
      </aside>

      <section className="appMain professionalMain">
        <header className="appTopbar professionalTopbar"><div className="topbarTitle"><span className="eyebrow">{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="topActions"><span className="network">{config.network.toUpperCase()}</span><Link className="secondary compactButton" href="/runtime">Runtime</Link></div></header>

        {(notice || failure) && <section className={failure ? "message error" : "message success"}>{failure || notice}</section>}

        <div className="pageCanvas">
          {section === "disclosures" && (
            <section className="singleWorkspace"><form className="panel primaryPanel" onSubmit={createIncomeDisclosure}>
              <div className="panelHeader"><div><span className="sectionKicker">Verifier-scoped proof</span><h3>Create disclosure</h3></div><span className="securityTag">Selective</span></div>
              <p>Bind one verified fact to one verifier and an explicit expiry. Exact salary stays private.</p>
              <div className="twoCol"><label>Employee reference<input value={employeeRef} onChange={(e) => setEmployeeRef(e.target.value)} placeholder="employee-001" /></label><label>Verifier reference<input value={verifierRef} onChange={(e) => setVerifierRef(e.target.value)} placeholder="landlord-or-lender" /></label></div>
              <div className="twoCol"><label>Income threshold in minor units<input inputMode="numeric" value={thresholdMinor} onChange={(e) => setThresholdMinor(e.target.value)} placeholder="250000" /></label><label>Expires at<input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label></div>
              <div className="actionBar multiAction"><span>Only the scoped fact is disclosed.</span><div><button className="primary" disabled={busy}>Prove income</button><button className="secondary" type="button" disabled={busy} onClick={createEmploymentDisclosure}>Prove employment</button><button className="secondary" type="button" disabled={busy || !lastDisclosure} onClick={revokeLastDisclosure}>Revoke</button></div></div>
              {lastDisclosure && <p className="monoNote">Last disclosure: <code>{lastDisclosure.id}</code></p>}
            </form></section>
          )}

          {section === "employee-access" && (
            <section className="singleWorkspace"><form className="panel primaryPanel" onSubmit={issuePrivatePayslip}>
              <div className="panelHeader"><div><span className="sectionKicker">Wallet-bound delivery</span><h3>Payslip & access package</h3></div><span className="securityTag">AES-GCM</span></div>
              <p>Backfill an existing v2 pay run when needed, then export a fresh v3 package after funding so the employee receives the encrypted one-time claim capability.</p>
              <div className="twoCol"><label>Employee reference<input value={payslipEmployeeRef} onChange={(e) => setPayslipEmployeeRef(e.target.value)} placeholder="employee-001" /></label><label>Pay run reference<input value={payslipRunRef} onChange={(e) => setPayslipRunRef(e.target.value)} placeholder="2026-09" /></label></div>
              <div className="twoCol"><label>Period<input inputMode="numeric" value={payslipPeriod} onChange={(e) => setPayslipPeriod(e.target.value)} placeholder="202609" /></label><label>Currency<input value={payslipCurrency} onChange={(e) => setPayslipCurrency(e.target.value)} placeholder="TOKEN" /></label></div>
              <div className="twoCol"><label>Gross minor units<input inputMode="numeric" value={payslipGross} onChange={(e) => setPayslipGross(e.target.value)} placeholder="325000" /></label><label>Net minor units<input inputMode="numeric" value={payslipNet} onChange={(e) => setPayslipNet(e.target.value)} placeholder="325000" /></label></div>
              <label>Settlement transaction ID (only after paid)<input value={payslipTx} onChange={(e) => setPayslipTx(e.target.value)} placeholder="Leave blank until employee claim settles" /></label>
              <div className="actionBar"><span>Salary remains in encrypted private state.</span><button className="primary" disabled={busy}>Save encrypted payslip</button></div>
              <div className="employeeAccessBlock"><label>Employee access package password<input type="password" value={employeeAccessPassword} onChange={(e) => setEmployeeAccessPassword(e.target.value)} placeholder="16+ chars, 3 character classes" autoComplete="new-password" /></label><div className="actionBar"><span>Package is bound to the v2 employee commitment and Lace payout key.</span><button className="secondary" type="button" disabled={busy || !payslipEmployeeRef.trim()} onClick={exportEmployeeAccess}>Export v3 access package</button></div></div>
            </form></section>
          )}

          {section === "audit" && (
            <section className="singleWorkspace"><form className="panel primaryPanel" onSubmit={buildAudit}>
              <div className="panelHeader"><div><span className="sectionKicker">Redacted evidence</span><h3>Public audit bundle</h3></div><span className="securityTag">No payroll secrets</span></div>
              <p>Export only public proof references and commitments. Salary, payout destinations, salts and witnesses are structurally excluded.</p>
              <label>Proof IDs<textarea rows={3} value={proofRefs} onChange={(e) => setProofRefs(e.target.value)} placeholder="one 32-byte hex proof ID per line" /></label>
              <label>Disclosure IDs<textarea rows={3} value={disclosureRefs} onChange={(e) => setDisclosureRefs(e.target.value)} placeholder="one 32-byte hex disclosure ID per line" /></label>
              <label>Settlement commitments<textarea rows={3} value={transactionRefs} onChange={(e) => setTransactionRefs(e.target.value)} placeholder="one 32-byte hex commitment per line" /></label>
              <div className="actionBar"><span>Output contains public references only.</span><button className="primary" disabled={busy}>Build audit bundle</button></div>
              {auditPreview && <pre className="auditPreview">{auditPreview}</pre>}
            </form></section>
          )}
        </div>

        <footer className="polishedFooter"><div><span className="footerBrand">Blackpay</span><p>Confidential payroll on Midnight.</p></div><div className="footerMeta"><span>Protocol v2</span><span>{config.network.toUpperCase()} testnet</span><span>Private by default</span></div></footer>
      </section>
    </main>
  );
}

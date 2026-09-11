"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getMidnightPublicConfig } from "@/lib/midnight/network";
import {
  connectMidnightWallet,
  getConnectedMidnightWallet,
  listMidnightWallets,
  type AvailableWallet,
  type ConnectedWallet,
} from "@/lib/midnight/wallet";
import {
  isPayrollContractGatewayReady,
  subscribePayrollContractGateway,
} from "@/lib/midnight/contract-client";

type IconName =
  | "dashboard"
  | "workspace"
  | "employees"
  | "payruns"
  | "proofs"
  | "disclosures"
  | "access"
  | "audit"
  | "portal"
  | "blackout"
  | "runtime";

const employerNav: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/workspace", label: "Workspace", icon: "workspace" },
  { href: "/employees", label: "Employees", icon: "employees" },
  { href: "/pay-runs", label: "Pay runs", icon: "payruns" },
  { href: "/proofs", label: "Proofs", icon: "proofs" },
];

const privateNav: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/blackout-payroll", label: "Blackout Payroll", icon: "blackout" },
  { href: "/disclosures", label: "Disclosures", icon: "disclosures" },
  { href: "/employee-access", label: "Employee access", icon: "access" },
  { href: "/audit", label: "Audit", icon: "audit" },
  { href: "/employee", label: "Employee portal", icon: "portal" },
];

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "dashboard") return <svg {...common}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>;
  if (name === "workspace") return <svg {...common}><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></svg>;
  if (name === "employees") return <svg {...common}><path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M17 11a4 4 0 0 1 4 4v2M16 3.4a4 4 0 0 1 0 7.2" /></svg>;
  if (name === "payruns") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
  if (name === "proofs") return <svg {...common}><path d="M12 3 4.5 6v5.5c0 4.7 3.2 8 7.5 9.5 4.3-1.5 7.5-4.8 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "disclosures") return <svg {...common}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
  if (name === "access") return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  if (name === "audit") return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20V7" /></svg>;
  if (name === "portal") return <svg {...common}><rect x="3" y="3" width="14" height="18" rx="2" /><path d="M10 12h11M17 8l4 4-4 4" /></svg>;
  if (name === "blackout") return <svg {...common}><rect x="3" y="3" width="18" height="18" /><path d="M8 7v10M16 7v10M12 3v18" /></svg>;
  return <svg {...common}><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></svg>;
}

function navLink(item: { href: string; label: string; icon: IconName }, active = false) {
  return (
    <Link key={item.href} className={active ? "premiumNavLink active" : "premiumNavLink"} href={item.href}>
      <span className="premiumNavIcon"><Icon name={item.icon} /></span>
      <span>{item.label}</span>
    </Link>
  );
}

export function PremiumDashboard() {
  const config = useMemo(() => getMidnightPublicConfig(), []);
  const [wallets, setWallets] = useState<AvailableWallet[]>([]);
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setWallets(listMidnightWallets());
    setRuntimeReady(isPayrollContractGatewayReady());
    try {
      setConnected(getConnectedMidnightWallet());
    } catch {
      // No active wallet session in this browser tab yet.
    }
    return subscribePayrollContractGateway(setRuntimeReady);
  }, []);

  async function connect(walletId?: string) {
    setBusy(true);
    setNotice("");
    try {
      const connection = await connectMidnightWallet(walletId);
      setConnected(connection);
      setNotice(`Connected to ${connection.name} on ${config.network}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to connect wallet");
    } finally {
      setBusy(false);
    }
  }

  const walletState = connected ? "Connected" : wallets.length ? "Available" : "Not detected";
  const contractState = runtimeReady ? "Runtime ready" : connected ? "Runtime required" : "Waiting";

  return (
    <main className="premiumDashShell">
      <aside className="premiumDashSidebar">
        <Link className="premiumBrand" href="/" aria-label="Blackpay dashboard">
          <span className="premiumBrandMark"><i /><i /></span>
          <span><strong>Blackpay</strong><small>Protocol V2</small></span>
        </Link>

        <div className="premiumNavGroup">
          <span className="premiumNavLabel">Employer</span>
          <nav>{employerNav.map((item) => navLink(item, item.href === "/"))}</nav>
        </div>

        <div className="premiumNavGroup premiumNavSeparated">
          <span className="premiumNavLabel">Private operations</span>
          <nav>{privateNav.map((item) => navLink(item))}</nav>
        </div>

        <div className="premiumNavGroup premiumNavSeparated">
          <span className="premiumNavLabel">Infrastructure</span>
          <nav>{navLink({ href: "/runtime", label: "Runtime & recovery", icon: "runtime" })}</nav>
        </div>

        <div className="premiumSideNote">
          <span className="premiumSideLock">⌁</span>
          <div><strong>Private by design.</strong><small>Built for verifiable payroll.</small></div>
          <Link href="/proofs" aria-label="Open proofs">→</Link>
        </div>
      </aside>

      <section className="premiumDashMain">
        <header className="premiumDashTopbar">
          <div className="premiumConsoleName">
            <span>Employer console</span>
            <i />
            <strong>Blackpay Protocol V2</strong>
          </div>
          <div className="premiumTopActions">
            <span className="premiumNetworkBadge">{config.network.toUpperCase()}</span>
            {connected ? (
              <span className="premiumWalletBadge"><b className="premiumLiveDot" />{connected.name}</span>
            ) : wallets.length <= 1 ? (
              <button className="premiumConnect" disabled={busy} onClick={() => connect(wallets[0]?.id)}>Connect wallet</button>
            ) : (
              wallets.map((wallet) => <button className="premiumConnect" disabled={busy} key={wallet.id} onClick={() => connect(wallet.id)}>{wallet.name}</button>)
            )}
          </div>
        </header>

        {notice && <div className="premiumNotice">{notice}</div>}

        <section className="premiumHero">
          <div className="premiumHeroCopy">
            <span className="premiumEyebrow">Confidential payroll infrastructure</span>
            <h1>Private payroll.<br /><em>Verifiable settlement.</em></h1>
            <p>Blackpay keeps compensation and payout data private while preserving auditable payroll state on Midnight.</p>
            <div className="premiumHeroActions">
              {!connected && <button className="premiumConnect premiumHeroButton" disabled={busy} onClick={() => connect(wallets[0]?.id)}>Connect wallet</button>}
              <Link className="premiumSecondaryButton" href="/runtime"><span>▶</span> Open runtime <small>V2</small></Link>
            </div>
            <div className="premiumAssurances">
              <span><i>✓</i> Confidential salary data</span>
              <span><i>✓</i> Contract-bound settlement</span>
              <span><i>✓</i> Wallet-bound employee claims</span>
            </div>
          </div>

          <Link className="premiumProtocolCard" href="/runtime">
            <div className="premiumProtocolArt"><i /><i /><i /></div>
            <span>Blackpay protocol</span>
            <strong>V2</strong>
            <p>Contract-bound claims for private payroll settlement.</p>
            <div className="premiumProtocolFoot"><small>Midnight Preview</small><b>→</b></div>
          </Link>
        </section>

        <section className="premiumStatusRow" aria-label="Blackpay live status">
          <article><span className="premiumStatIcon"><Icon name="employees" /></span><div><small>Wallet</small><strong>{walletState}</strong></div><em>{connected ? "Session authorized" : "Lace / Midnight"}</em></article>
          <article><span className="premiumStatIcon"><Icon name="runtime" /></span><div><small>Contract</small><strong>{contractState}</strong></div><em>Protocol V2</em></article>
          <article><span className="premiumStatIcon"><Icon name="proofs" /></span><div><small>Settlement</small><strong>Claim bound</strong></div><em>One-time employee claim</em></article>
          <article><span className="premiumStatIcon"><Icon name="dashboard" /></span><div><small>Network</small><strong>{config.network.toUpperCase()}</strong></div><em>Testnet environment</em></article>
        </section>

        <section className="premiumDashboardGrid">
          <article className="premiumWorkspacePanel">
            <div className="premiumPanelHeader">
              <div><span className="premiumEyebrow">Operations</span><h2>Payroll workspaces</h2><p>Move directly into each controlled payroll room.</p></div>
              <Link href="/workspace">Open workspace →</Link>
            </div>
            <div className="premiumRoomGrid">
              <Link href="/workspace"><span><Icon name="workspace" /></span><div><strong>Workspace</strong><small>Identity, token label and cadence</small></div><b>→</b></Link>
              <Link href="/employees"><span><Icon name="employees" /></span><div><strong>Employees</strong><small>Private salary and payout commitments</small></div><b>→</b></Link>
              <Link href="/pay-runs"><span><Icon name="payruns" /></span><div><strong>Pay runs</strong><small>Create, approve and fund exact claims</small></div><b>→</b></Link>
              <Link href="/proofs"><span><Icon name="proofs" /></span><div><strong>Proofs</strong><small>Verify income without revealing salary</small></div><b>→</b></Link>
              <Link className="premiumBlackoutRoom" href="/blackout-payroll"><span><Icon name="blackout" /></span><div><strong>Blackout Payroll</strong><small>Cyber-private payroll workspace</small></div><b>NEW →</b></Link>
            </div>
          </article>

          <article className="premiumIntegrityPanel">
            <div className="premiumPanelHeader compact">
              <div><span className="premiumEyebrow">Settlement integrity</span><h2>What V2 enforces</h2></div>
              <Link href="/pay-runs">View flow →</Link>
            </div>
            <div className="premiumIntegrityBody">
              <div className="premiumIntegrityRing"><div><strong>V2</strong><small>BOUND</small></div></div>
              <div className="premiumIntegrityList">
                <span><i>✓</i> Exact payment claims committed</span>
                <span><i>✓</i> Contract-controlled funding</span>
                <span><i>✓</i> Employee wallet binding</span>
                <span><i>✓</i> One-time settlement claim</span>
              </div>
            </div>
            <Link className="premiumIntegrityFooter" href="/audit"><span>Auditable state without public salary data.</span><b>→</b></Link>
          </article>
        </section>

        <section className="premiumClosing">
          <div><span className="premiumEyebrow">Private by default</span><h2>Payroll infrastructure that reveals only what needs to be proven.</h2></div>
          <div className="premiumClosingLinks"><Link href="/blackout-payroll">Blackout Payroll →</Link><Link href="/disclosures">Selective disclosures →</Link><Link href="/employee">Employee portal →</Link></div>
        </section>

        <footer className="premiumFooter">
          <div><strong>Blackpay</strong><span>Confidential payroll on Midnight.</span></div>
          <div><span>Protocol V2</span><span>{config.network.toUpperCase()} testnet</span><span>Private salaries · Public proof</span></div>
        </footer>
      </section>
    </main>
  );
}

import Link from "next/link";
import { BlackpayAppClientOnly } from "@/components/BlackpayAppClientOnly";

export function BlackoutPayroll() {
  return (
    <div className="blackoutPayrollExperience">
      <div className="blackoutStatusStrip">
        <span><i /> BLACKOUT PAYROLL // CONFIDENTIAL SETTLEMENT</span>
        <div>
          <span>BLACKPAY PROTOCOL V2</span>
          <span className="blackoutStatusLive">MIDNIGHT PREVIEW</span>
        </div>
      </div>

      <header className="blackoutHeader">
        <Link className="blackoutBrand" href="/">
          <span className="blackoutBrandMark"><i /></span>
          <span><strong>BLACKOUT</strong><small>PAYROLL / MIDNIGHT</small></span>
        </Link>

        <nav className="blackoutNav" aria-label="Blackout Payroll navigation">
          <Link href="/">DASHBOARD</Link>
          <Link href="/pay-runs">CORE PAY RUNS</Link>
          <Link className="active" href="/blackout-payroll">BLACKOUT PAYROLL <b>NEW</b></Link>
          <Link href="/employee">EMPLOYEE PORTAL</Link>
        </nav>

        <a className="blackoutNavAction" href="#blackout-workspace">[ OPEN PAYROLL ]</a>
      </header>

      <section className="blackoutHero">
        <div className="blackoutGrid" aria-hidden="true" />
        <div className="blackoutHeroInner">
          <div className="blackoutHeroMeta">
            <span><i /> BLACKOUT / PAYROLL</span>
            <span>POWERED BY MIDNIGHT <b>TESTNET</b></span>
          </div>

          <div className="blackoutHeroCopy">
            <span className="blackoutEyebrow">[ CONFIDENTIAL PAYROLL INFRASTRUCTURE ]</span>
            <h1>MAKE PAYROLL PRIVATE.</h1>
            <p>Compensation should not become public data just because payroll moves onchain.</p>
          </div>

          <div className="blackoutThesisBar">
            <span><strong>BLACKPAY:</strong> CONTRACT-BOUND SETTLEMENT.</span>
            <i>•</i>
            <span><strong>BLACKOUT PAYROLL:</strong> PAY PRIVATELY.</span>
            <a href="#blackout-workspace">ENTER WORKSPACE ↓</a>
          </div>
        </div>
      </section>

      <section className="blackoutOverview">
        <div className="blackoutSectionHeader">
          <div>
            <span className="blackoutEyebrow">[ INSTITUTIONAL TREASURY WORKSPACE ]</span>
            <h2>PAYROLL OVERVIEW</h2>
          </div>
          <a href="#blackout-workspace">+ CREATE PAYROLL</a>
        </div>

        <div className="blackoutMetricGrid">
          <article><span>COMPENSATION</span><strong>PRIVATE</strong><small>Exact salary remains outside public ledger state.</small></article>
          <article><span>PAYMENT CLAIMS</span><strong>BOUND</strong><small>Each employee payment is committed to the approved run.</small></article>
          <article><span>FUNDING MODEL</span><strong>CUSTODY</strong><small>Approved claims are funded through contract-controlled settlement.</small></article>
          <article><span>EMPLOYEE CLAIM</span><strong>ONE TIME</strong><small>Wallet-bound salary claims cannot be replayed.</small></article>
        </div>
      </section>

      <section id="blackout-workspace" className="blackoutWorkspace">
        <div className="blackoutSectionHeader workspaceHeader">
          <div>
            <span className="blackoutEyebrow">[ LIVE BLACKPAY V2 ENGINE ]</span>
            <h2>CREATE → APPROVE → FUND</h2>
          </div>
          <span className="blackoutZeroTag">ZERO PUBLIC SALARY DISCLOSURE</span>
        </div>

        <div className="blackoutEngineNote">
          <span>THIS IS THE REAL BLACKPAY TESTNET PAYROLL FLOW.</span>
          <p>Connect Lace, join or deploy the Blackpay v2 runtime, create the exact private pay run, approve it, then fund employee claims.</p>
        </div>

        <div className="blackoutPayrollRuntime">
          <BlackpayAppClientOnly section="pay-runs" />
        </div>
      </section>

      <section className="blackoutProtection">
        <div className="blackoutSectionHeader">
          <div>
            <span className="blackoutEyebrow">[ TECHNICAL ARCHITECTURE ]</span>
            <h2>WHAT BLACKOUT PAYROLL PROTECTS</h2>
          </div>
          <span className="blackoutZeroTag green">◇ ZERO-KNOWLEDGE / PRIVATE STATE</span>
        </div>

        <blockquote>“Payroll should prove that payment conditions were satisfied without turning employee compensation into public data.”</blockquote>

        <div className="blackoutProtectionGrid">
          <article><div><strong>COMPENSATION</strong><b>PRIVATE</b></div><p>Individual salary figures remain inside encrypted private state and witness material.</p></article>
          <article><div><strong>PAYOUT DESTINATION</strong><b>COMMITTED</b></div><p>The employee payout destination is cryptographically bound without publishing the full private record.</p></article>
          <article><div><strong>PAYROLL CLAIM SET</strong><b>BOUND</b></div><p>Approval is tied to the exact committed employee payment set for the pay run.</p></article>
          <article><div><strong>SETTLEMENT</strong><b>ONE TIME</b></div><p>Employee claims are wallet-bound and cannot be replayed after settlement.</p></article>
        </div>
      </section>

      <section className="blackoutFinalStatement">
        <span className="blackoutEyebrow">[ BLACKOUT PAYROLL ]</span>
        <div>
          <h2>PAY PRIVATELY.<br />PROVE WHAT MATTERS.</h2>
          <p>Blackout Payroll is now part of the Blackpay system, using the same working Midnight payroll engine behind a dedicated cyber-privacy interface.</p>
        </div>
      </section>

      <footer className="blackoutFooter">
        <div>
          <Link href="/">[ BLACKPAY DASHBOARD ]</Link>
          <Link href="/runtime">[ RUNTIME & RECOVERY ]</Link>
          <Link href="/employee">[ EMPLOYEE PORTAL ]</Link>
        </div>
        <span>BLACKOUT PAYROLL · BLACKPAY PROTOCOL V2 · MIDNIGHT PREVIEW</span>
      </footer>
    </div>
  );
}

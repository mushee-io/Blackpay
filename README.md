# Blackpay

**Confidential payroll on Midnight. Private salaries. Public proof.**

Blackpay is a Midnight-native confidential payroll protocol for employers and employees. Salary amounts, payout destinations, salts, settlement capabilities, and private witnesses stay private while the ledger stores commitments, lifecycle state, and verifiable proofs.

## Protocol v2

Blackpay protocol v2 removes the legacy arbitrary transaction-hash finalization path. Payroll settlement is contract-bound:

1. The employer registers each employee with a private salary record and fixed shielded payout key.
2. A pay run commits to the exact private payment set and payroll token.
3. Each employee payment is registered as a claim against that committed payment root.
4. Approval is impossible until every expected claim is registered and the registered root matches the private pay-run commitment.
5. The employer funds each approved claim into Midnight shielded contract custody.
6. A fresh encrypted v3 employee access package carries only that employee's private claim capability.
7. The bound employee Lace wallet claims the contract-held salary once.
8. The contract verifies the claim, amount, token, funded coin, and fixed payout key before settlement. A settled claim cannot be replayed.
9. The pay run reaches `Executed` only when all employee claims have settled.

There is no demo transaction path, fake proof path, or `finalizePayRun(txHash)` fallback.

## Product scope

Blackpay currently includes:

- Midnight Preview wallet/runtime connection
- Employer payroll workspace
- Private employee registry
- Confidential pay-run commitments
- Contract-bound shielded payroll funding
- Employee one-time shielded salary claims
- Private employee payslips and encrypted v3 access packages
- Zero-knowledge income-threshold proofs
- Verifier-scoped employment/income disclosures
- Redacted audit bundles
- Typed protocol-v2 SDK gateway

## Privacy boundary

Blackpay must never place plaintext salary, payout destinations, salts, funded-coin capabilities, or private witness values in public ledger state, URLs, analytics, application logs, or browser console output.

Public state is limited to identifiers, commitments, lifecycle state, counts, intentionally disclosed proof thresholds, and proof/disclosure results. The employee access package is AES-GCM encrypted and wallet-bound before its private settlement capability is installed.

## Midnight compatibility target

- Compact toolchain: `0.31.1`
- Compact language: `0.23`
- Compact runtime: `0.16.0`
- MidnightJS: `4.1.1`
- DApp connector API: `4.0.1`
- Ledger: `8.1.0`
- Node.js: `22.x`
- Network default: `preview`

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Compile and verify the real Compact contract:

```bash
npm run compact:compile
```

Build the same live artifact path used by Vercel:

```bash
npm run build:live
```

The application is fail-closed: missing wallet support, network mismatch, incompatible protocol version, missing generated bindings/proving assets, proof failure, or transaction failure surfaces as an error.

## Deployment rule

Protocol v2 requires a **new Midnight contract deployment**. A legacy Blackpay v1 contract must not be reused because deployed Compact contracts are immutable. The runtime checks `protocolVersion == 2` before registering the live payroll gateway.

After deploying v2, the employer flow is:

`Create workspace -> Add employees -> Create pay run -> Approve -> Fund contract claims -> Export fresh v3 employee package`

The employee flow is:

`Connect bound Lace wallet -> Join v2 contract -> Import v3 package -> Claim shielded salary`

## Repository layout

```text
contract/                 Compact protocol-v2 payroll contract
src/app/                  Next.js application
src/components/           Employer and employee UI
src/lib/midnight/          Wallet, providers, runtime, encrypted state, settlement
src/lib/payroll/           Payroll domain types and validation
src/lib/sdk/               Typed protocol-v2 SDK facade
scripts/                   Compact/build/privacy checks
```

## Release gate

Code is not considered live merely because it is merged. A release requires all CI jobs to pass on the same commit (`app`, `compact`, and `live-assets`), followed by a real Lace-signed Preview deployment and an end-to-end funded employee claim on the newly deployed v2 contract.

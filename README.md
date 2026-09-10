# Blackpay

**Confidential payroll on Midnight. Private salaries. Public proof.**

Blackpay is a Midnight-native payroll protocol for employers and employees. Salary amounts, payout destinations, and sensitive payroll inputs stay private while the ledger stores commitments, payroll state, and verifiable eligibility proofs.

## Current build scope

Milestones 1–6 are being implemented as the first vertical slice:

1. Midnight foundation and wallet connection
2. Employer payroll workspace
3. Private employee registry
4. Confidential pay-run lifecycle
5. Shielded payroll payment flow
6. Zero-knowledge income-threshold proofs

## Privacy boundary

Blackpay must never place plaintext salary, private payout data, salts, or private witness values in public ledger state, URLs, analytics, application logs, or browser console output.

Public state is limited to identifiers, commitments, lifecycle state, counts, thresholds intentionally disclosed for verification, and proof results.

## Midnight compatibility target

- Compact language: `0.23`
- MidnightJS: `4.1.1`
- DApp connector API: `4.0.1`
- Ledger: `8.1.0`
- Node.js: `>=22`
- Network default: `preview`

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Compile the Compact contract with an installed Compact toolchain:

```bash
npm run compact:compile
```

The application is fail-closed: missing wallet support, network mismatch, missing generated contract bindings, proof-server failure, or transaction failure must surface as an error. There is no demo transaction or fake proof fallback.

## Repository layout

```text
contract/                 Compact payroll contract
src/app/                  Next.js application
src/components/           Employer/employee UI
src/lib/midnight/          Wallet, network and payment adapters
src/lib/payroll/           Payroll domain types and validation
scripts/                   Build/privacy checks
```

## Status

This repository is under active development. A feature is not considered live until its Compact artifacts compile and its transaction/proof path succeeds against Midnight Preview.

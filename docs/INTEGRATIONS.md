# Blackpay integrations

Blackpay integrations must preserve the same privacy boundary as the application: private salary values, payout destinations, salts, employee witness records, and private pay-run inputs must not be sent to public APIs or analytics.

## Public-safe API

`GET /api/v1/status`

Returns only deployment-readiness metadata: service version, Midnight network, whether the contract/services are configured, privacy mode, and milestone status. It does not return payroll records.

## TypeScript SDK

`src/lib/sdk/blackpay.ts` exposes `BlackpaySdk`, a typed façade over the registered `PayrollContractGateway`.

The SDK does not create a simulated gateway. If generated Compact bindings and real Midnight providers have not registered a gateway, construction through the default path fails closed.

Supported protocol calls:

- create employer workspace
- add private employee commitment
- create/approve/finalize pay run
- prove income threshold
- create verifier-scoped income disclosure
- create verifier-scoped active-employment disclosure
- revoke selective disclosure

## Selective disclosure

A disclosure is bound to:

- the employee commitment
- a disclosure kind
- a verifier identifier commitment
- an expiry timestamp
- a unique nonce-derived disclosure ID

Income disclosures store a hash of the threshold rather than the exact salary. Active-employment disclosures store a hash of the boolean fact.

The current contract records expiry metadata but does not provide a standalone on-chain verifier circuit that evaluates current ledger time. Integrators must treat an expired disclosure as invalid, and the planned verifier adapter must enforce expiry before returning a valid result.

## Payslips

The current browser implementation stores payslips only in volatile session memory. This is intentional until encrypted private persistence and employee recovery are implemented. Public integrations must never receive the payslip amount fields.

## Audit bundles

`buildPublicAuditBundle()` accepts only public 32-byte proof IDs, disclosure IDs, and settlement commitments. Its type intentionally contains no salary, recipient, salt, or witness fields.

## Live integration requirement

Before a partner integration is called live:

```bash
npm run compact:compile
npm run release:check
npm run live:verify
```

These checks do not replace an interactive Midnight Preview test. Wallet signing, contract deployment provenance, shielded settlement, disclosure creation/revocation, and proof verification must still be observed against the target network.

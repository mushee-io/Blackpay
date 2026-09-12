import { cp, mkdir, rm, stat } from "node:fs/promises";

const payrollBuildRoot = "contract/build";
const invoiceBuildRoot = "contract/invoice-build";
const publicRoot = "public";
const payrollGeneratedRoot = "src/generated/blackpay";
const invoiceGeneratedRoot = "src/generated/invoice";
const payrollCircuits = [
  "createWorkspace",
  "addEmployee",
  "updateEmployee",
  "removeEmployee",
  "createPayRun",
  "registerPayRunPayment",
  "approvePayRun",
  "fundPayRunPayment",
  "claimPayRunPayment",
  "proveIncomeAtLeast",
  "createIncomeDisclosure",
  "createEmploymentDisclosure",
  "revokeDisclosure",
];
const invoiceCircuits = ["createInvoice", "acceptInvoice", "fundInvoice", "payInvoice"];

async function requireFile(path) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error(`Missing required Compact asset: ${path}`);
}

async function verifyBuild(buildRoot, circuits) {
  await requireFile(`${buildRoot}/contract/index.js`);
  await requireFile(`${buildRoot}/contract/index.d.ts`);
  await requireFile(`${buildRoot}/compiler/contract-info.json`);
  for (const circuit of circuits) {
    await requireFile(`${buildRoot}/keys/${circuit}.prover`);
    await requireFile(`${buildRoot}/keys/${circuit}.verifier`);
    await requireFile(`${buildRoot}/zkir/${circuit}.bzkir`);
  }
}

await verifyBuild(payrollBuildRoot, payrollCircuits);
await verifyBuild(invoiceBuildRoot, invoiceCircuits);

await rm(`${publicRoot}/keys`, { recursive: true, force: true });
await rm(`${publicRoot}/zkir`, { recursive: true, force: true });
await rm(`${publicRoot}/compact`, { recursive: true, force: true });
await rm(`${publicRoot}/invoice`, { recursive: true, force: true });
await rm(payrollGeneratedRoot, { recursive: true, force: true });
await rm(invoiceGeneratedRoot, { recursive: true, force: true });

await mkdir(`${publicRoot}/keys`, { recursive: true });
await mkdir(`${publicRoot}/zkir`, { recursive: true });
await mkdir(`${publicRoot}/compact`, { recursive: true });
await mkdir(`${publicRoot}/invoice/keys`, { recursive: true });
await mkdir(`${publicRoot}/invoice/zkir`, { recursive: true });
await mkdir(`${publicRoot}/invoice/compact`, { recursive: true });
await mkdir(payrollGeneratedRoot, { recursive: true });
await mkdir(invoiceGeneratedRoot, { recursive: true });

await cp(`${payrollBuildRoot}/keys`, `${publicRoot}/keys`, { recursive: true });
await cp(`${payrollBuildRoot}/zkir`, `${publicRoot}/zkir`, { recursive: true });
await cp(`${payrollBuildRoot}/compiler/contract-info.json`, `${publicRoot}/compact/contract-info.json`);
await cp(`${payrollBuildRoot}/contract`, payrollGeneratedRoot, { recursive: true });

await cp(`${invoiceBuildRoot}/keys`, `${publicRoot}/invoice/keys`, { recursive: true });
await cp(`${invoiceBuildRoot}/zkir`, `${publicRoot}/invoice/zkir`, { recursive: true });
await cp(`${invoiceBuildRoot}/compiler/contract-info.json`, `${publicRoot}/invoice/compact/contract-info.json`);
await cp(`${invoiceBuildRoot}/contract`, invoiceGeneratedRoot, { recursive: true });

await requireFile(`${payrollGeneratedRoot}/index.js`);
await requireFile(`${invoiceGeneratedRoot}/index.js`);
await requireFile(`${publicRoot}/compact/contract-info.json`);
await requireFile(`${publicRoot}/invoice/compact/contract-info.json`);
console.log(`Prepared ${payrollCircuits.length} payroll circuits and ${invoiceCircuits.length} Blackout Invoice circuits.`);

import { cp, mkdir, rm, stat } from "node:fs/promises";

const buildRoot = "contract/build";
const publicRoot = "public";
const generatedRoot = "src/generated/blackpay";
const circuits = [
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

async function requireFile(path) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error(`Missing required Compact asset: ${path}`);
}

await requireFile(`${buildRoot}/contract/index.js`);
await requireFile(`${buildRoot}/contract/index.d.ts`);
await requireFile(`${buildRoot}/compiler/contract-info.json`);
for (const circuit of circuits) {
  await requireFile(`${buildRoot}/keys/${circuit}.prover`);
  await requireFile(`${buildRoot}/keys/${circuit}.verifier`);
  await requireFile(`${buildRoot}/zkir/${circuit}.bzkir`);
}

await rm(`${publicRoot}/keys`, { recursive: true, force: true });
await rm(`${publicRoot}/zkir`, { recursive: true, force: true });
await rm(`${publicRoot}/compact`, { recursive: true, force: true });
await rm(generatedRoot, { recursive: true, force: true });

await mkdir(`${publicRoot}/keys`, { recursive: true });
await mkdir(`${publicRoot}/zkir`, { recursive: true });
await mkdir(`${publicRoot}/compact`, { recursive: true });
await mkdir(generatedRoot, { recursive: true });

await cp(`${buildRoot}/keys`, `${publicRoot}/keys`, { recursive: true });
await cp(`${buildRoot}/zkir`, `${publicRoot}/zkir`, { recursive: true });
await cp(`${buildRoot}/compiler/contract-info.json`, `${publicRoot}/compact/contract-info.json`);
await cp(`${buildRoot}/contract`, generatedRoot, { recursive: true });

await requireFile(`${generatedRoot}/index.js`);
await requireFile(`${publicRoot}/compact/contract-info.json`);
console.log(`Prepared Blackpay protocol v2 Next.js Compact runtime and browser proving assets for ${circuits.length} circuits.`);

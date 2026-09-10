import { cp, mkdir, rm, stat } from "node:fs/promises";
import { build } from "esbuild";

const buildRoot = "contract/build";
const publicRoot = "public";
const circuits = [
  "createWorkspace",
  "addEmployee",
  "updateEmployee",
  "removeEmployee",
  "createPayRun",
  "approvePayRun",
  "finalizePayRun",
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
for (const circuit of circuits) {
  await requireFile(`${buildRoot}/keys/${circuit}.prover`);
  await requireFile(`${buildRoot}/keys/${circuit}.verifier`);
  await requireFile(`${buildRoot}/zkir/${circuit}.bzkir`);
}

await rm(`${publicRoot}/keys`, { recursive: true, force: true });
await rm(`${publicRoot}/zkir`, { recursive: true, force: true });
await rm(`${publicRoot}/compact`, { recursive: true, force: true });
await mkdir(`${publicRoot}/keys`, { recursive: true });
await mkdir(`${publicRoot}/zkir`, { recursive: true });
await mkdir(`${publicRoot}/compact`, { recursive: true });

await cp(`${buildRoot}/keys`, `${publicRoot}/keys`, { recursive: true });
await cp(`${buildRoot}/zkir`, `${publicRoot}/zkir`, { recursive: true });
await cp(`${buildRoot}/compiler/contract-info.json`, `${publicRoot}/compact/contract-info.json`);

await build({
  entryPoints: [`${buildRoot}/contract/index.js`],
  outfile: `${publicRoot}/compact/blackpay.generated.js`,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  minify: true,
  logLevel: "warning",
});

await requireFile(`${publicRoot}/compact/blackpay.generated.js`);
console.log(`Prepared Blackpay browser Compact assets for ${circuits.length} circuits.`);

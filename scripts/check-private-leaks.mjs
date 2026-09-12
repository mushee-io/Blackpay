import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOTS = ["src", "contract"];
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".compact"]);
const forbidden = [
  { pattern: /console\.(log|debug|info|trace)\s*\(/, reason: "console output is forbidden in privacy-sensitive application code" },
  { pattern: /NEXT_PUBLIC_[A-Z0-9_]*(SALARY|SALT|MNEMONIC|SEED|PRIVATE_KEY|WITNESS|PASSWORD|PAYOUT|PAYSLIP|ADMIN_SECRET|INVOICE_AMOUNT|PAYER_COMMITMENT|SUPPLIER_KEY|FUNDED_COIN)/, reason: "private payroll or invoice values must never use NEXT_PUBLIC_*" },
  { pattern: /(demo|mock)[_-]?(proof|transaction|deployment)[_-]?fallback/i, reason: "fake proof/transaction fallbacks are forbidden" },
  { pattern: /dangerouslySetInnerHTML\s*=/, reason: "raw HTML injection is forbidden on privacy-sensitive surfaces" },
  { pattern: /document\.cookie\b/, reason: "browser cookies are forbidden for Blackpay private state" },
  { pattern: /(localStorage|sessionStorage)\.setItem\s*\([^\n,]*(salary|salt|mnemonic|seed|private[_-]?key|witness|payout|payslip|invoice[_-]?amount|payer[_-]?commitment|supplier[_-]?(key|coin)|funded[_-]?coin)/i, reason: "private payroll or invoice material must not be written to plaintext browser storage" },
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "build" || entry.name === "invoice-build" || entry.name === "managed" || entry.name === "generated") continue;
      files.push(...(await walk(path)));
    } else if (TEXT_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const root of ROOTS) {
  let files = [];
  try {
    files = await walk(root);
  } catch {
    continue;
  }
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) violations.push(`${file}: ${rule.reason}`);
    }
    if (file.startsWith(join("src", "lib", "midnight")) && /Math\.random\s*\(/.test(source)) {
      violations.push(`${file}: Math.random is forbidden in Midnight security-sensitive code`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Blackpay privacy check failed:\n${violations.map((v) => `- ${v}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Blackpay privacy check: PASS\n");

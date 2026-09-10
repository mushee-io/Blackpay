"use client";

import { useState } from "react";
import { getConnectedMidnightWallet } from "@/lib/midnight/wallet";
import { getMidnightPublicConfig } from "@/lib/midnight/network";
import {
  exportBlackpayEncryptedBackup,
  getBlackpayRuntimeStatus,
  initializeBlackpayPreview,
} from "@/lib/midnight/live-runtime";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Blackpay Preview error";
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

export function PreviewRuntimePanel() {
  const config = getMidnightPublicConfig();
  const [privateStatePassword, setPrivateStatePassword] = useState("");
  const [contractAddress, setContractAddress] = useState(config.contractAddress);
  const [backupPassword, setBackupPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState(getBlackpayRuntimeStatus());

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    setFailure("");
    try {
      await action();
      setStatus(getBlackpayRuntimeStatus());
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function initialize(mode: "deploy" | "join") {
    await run(async () => {
      const wallet = getConnectedMidnightWallet();
      if (!privateStatePassword) throw new Error("Enter a private-state encryption password");
      const result = await initializeBlackpayPreview({
        wallet,
        privateStatePassword,
        mode,
        contractAddress: mode === "join" ? contractAddress : undefined,
      });
      setContractAddress(result.contractAddress);
      setPrivateStatePassword("");
      setNotice(
        mode === "deploy"
          ? `Blackpay deployed and indexed. Contract: ${result.contractAddress}. Role: ${result.role}. Deployment tx: ${result.deploymentTransactionId ?? "confirmed"}.`
          : `Blackpay contract verified and joined. Role: ${result.role}.`,
      );
    });
  }

  async function exportBackup() {
    await run(async () => {
      if (!status.ready) throw new Error("Initialize the Blackpay Preview runtime first");
      if (!backupPassword) throw new Error("Enter a separate encryption password for the backup");
      const backup = await exportBlackpayEncryptedBackup(backupPassword);
      saveJsonFile(`blackpay-${backup.contractAddress.slice(0, 12)}-encrypted-backup.json`, backup);
      setBackupPassword("");
      setNotice("Encrypted Blackpay private-state and signing-key backup exported. Keep it offline and private.");
    });
  }

  return (
    <section className="panel wide previewRuntime" aria-label="Midnight Preview runtime">
      <div className="panelNumber">LIVE</div>
      <h3>Midnight Preview runtime</h3>
      <p>
        First connect the wallet in the Blackpay header. This runtime then uses real Compact bindings, wallet-delegated proving, encrypted private state and indexer-confirmed calls.
      </p>

      <div className="twoCol">
        <label>
          Contract address
          <input
            value={contractAddress}
            onChange={(event) => setContractAddress(event.target.value)}
            placeholder="Deployed Midnight contract address"
            autoComplete="off"
          />
        </label>
        <label>
          Private-state password
          <input
            type="password"
            value={privateStatePassword}
            onChange={(event) => setPrivateStatePassword(event.target.value)}
            placeholder="16+ chars, 3 character classes"
            autoComplete="new-password"
          />
        </label>
      </div>

      <div className="buttonRow">
        <button type="button" className="primary" disabled={busy} onClick={() => initialize("join")}>
          JOIN VERIFIED CONTRACT
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => initialize("deploy")}>
          DEPLOY NEW BLACKPAY
        </button>
      </div>

      {status.ready && (
        <div className="runtimeStatus">
          <strong>RUNTIME READY</strong>
          <span>{status.networkId?.toUpperCase()} · {status.role?.toUpperCase()}</span>
          <code>{status.contractAddress}</code>
        </div>
      )}

      {status.ready && (
        <div className="twoCol backupRow">
          <label>
            Backup encryption password
            <input
              type="password"
              value={backupPassword}
              onChange={(event) => setBackupPassword(event.target.value)}
              placeholder="Use a separate strong password"
              autoComplete="new-password"
            />
          </label>
          <button type="button" className="secondary" disabled={busy} onClick={exportBackup}>
            EXPORT ENCRYPTED RECOVERY BACKUP
          </button>
        </div>
      )}

      {(notice || failure) && <div className={failure ? "message error" : "message success"}>{failure || notice}</div>}
    </section>
  );
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPasskeyStore } from "../server/remote-passkeys.ts";
import { openRemoteAuditStore } from "../server/remote-audit-store.ts";
import { parseRecoveryRequest } from "../server/remote-passkey-recovery.ts";

test("offline recovery requires a private 2-operator request, durably audits and revokes all keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "dc24h-recovery-")); chmodSync(dir, 0o700);
  try {
    const catalog = join(dir, "passkeys.json"), audit = join(dir, "audit.jsonl"), req = join(dir, "request.json");
    const store = openPasskeyStore(catalog, "localhost");
    const handle = store.userHandle("7");
    for (const id of ["a".repeat(32), "b".repeat(32)]) store.add({
      actor: "7", userHandle: handle, id, publicKey: "c".repeat(60), counter: 0,
      deviceType: "singleDevice", backedUp: false, transports: [], name: "Passkey",
      createdAt: 10, lastUsedAt: null, revokedAt: null,
    });
    openRemoteAuditStore(audit).close();
    writeFileSync(req, JSON.stringify({ schema: 1, actor: "7", approvers: ["op-one", "op-two"] }), { mode: 0o600 });
    assert.equal(parseRecoveryRequest(req).actor, "7");
    assert.match(execFileSync(process.execPath, ["--import", "tsx", "server/remote-passkey-recovery.ts",
      "--catalog", catalog, "--rp-id", "localhost", "--audit", audit,
      "--request", req, "--offline-ack"], { encoding: "utf8" }), /2 keys revoked/);
    assert.equal(openPasskeyStore(catalog, "localhost").forActor("7").length, 0);
    const text = readFileSync(audit, "utf8");
    assert.match(text, /passkey_recovery_intent/);
    assert.match(text, /passkey_recovered/);
    assert.ok(!text.includes("op-one") && !text.includes('"actor"'));
    writeFileSync(req, JSON.stringify({ schema: 1, actor: "7", approvers: ["same", "same"] }));
    assert.throws(() => parseRecoveryRequest(req), /Unsafe/);
    chmodSync(req, 0o644);
    assert.throws(() => parseRecoveryRequest(req), /Unsafe/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

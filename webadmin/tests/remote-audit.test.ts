import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteAuditEvents, remoteAuditRecord } from "../server/remote-audit.ts";
import type { RemoteEvent } from "../server/remote-gateway.ts";
import { openRemoteAuditStore } from "../server/remote-audit-store.ts";
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("all fixed gateway audit events serialize as bounded, nonidentifying JSON lines", () => {
  assert.equal(remoteAuditEvents.length, 18);
  for (const event of remoteAuditEvents) {
    const line = remoteAuditRecord(event, 1_700_000_000_000);
    assert.ok(line.endsWith("\n") && line.length < 150);
    assert.deepEqual(JSON.parse(line), {
      schema: 1, component: "remote-gateway", event, at: "2023-11-14T22:13:20.000Z",
    });
    for (const forbidden of ["password", "actor_id", "otp", "cookie", "grant", "remote_addr", "csrf"])
      assert.ok(!line.includes(forbidden), forbidden);
  }
});

test("invalid event or clock values are refused, not interpolated into journal output", () => {
  for (const item of ["login_ok\npassword=secret", "otp=123456", "unaudited_success", ""]) {
    assert.throws(() => remoteAuditRecord(item as RemoteEvent, Date.now()), /Invalid local audit event/);
  }
  for (const item of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => remoteAuditRecord("login_refused", item), /Invalid local audit event/);
  }
});

test("durable gateway audit persists a sequential privacy-limited hash chain across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dc24h-audit-"));
  const path = join(dir, "gateway.jsonl");
  try {
    const first = openRemoteAuditStore(path);
    first.append("login_refused", 1_700_000_000_000);
    first.append("mfa_ok", 1_700_000_000_001);
    assert.deepEqual(first.health(), { healthy: true, dropped: 0, sequence: 2 });
    first.close();
    const second = openRemoteAuditStore(path);
    second.append("login_ok", 1_700_000_000_002);
    second.close();
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    const rows = lines.map(line => JSON.parse(line));
    assert.deepEqual(rows.map(r => r.sequence), [1, 2, 3]);
    assert.equal(rows[0].previous, "0".repeat(64));
    assert.equal(rows[2].previous, rows[1].digest);
    for (const name of ["password", "actor", "otp", "cookie", "ip", "csrf", "token"])
      assert.ok(!readFileSync(path, "utf8").includes('"' + name + '"'), name);
    // Modifying one record cannot be interpreted as a valid new history.
    writeFileSync(path, readFileSync(path, "utf8").replace('"mfa_ok"', '"logout"'), { mode: 0o600 });
    assert.throws(() => openRemoteAuditStore(path), /Invalid audit record/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("audit files refuse unsafe permissions, incomplete entries and path replacement; loss is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "dc24h-audit-sec-"));
  const path = join(dir, "audit.jsonl"), alias = join(dir, "alias.jsonl");
  try {
    const store = openRemoteAuditStore(path);
    store.append("login_refused", 1_700_000_000_000);
    renameSync(path, alias);
    writeFileSync(path, "", { mode: 0o600 });
    assert.throws(() => store.append("login_ok", 1_700_000_000_001), /rotated, corrupted or full/);
    assert.deepEqual(store.health(), { healthy: false, dropped: 1, sequence: 1 });
    assert.throws(() => store.append("login_ok", 1_700_000_000_002), /unavailable/);
    store.close();
    rmSync(path);
    chmodSync(alias, 0o644);
    assert.throws(() => openRemoteAuditStore(alias), /Unsafe or full/);
    chmodSync(alias, 0o600);
    symlinkSync(alias, path);
    assert.throws(() => openRemoteAuditStore(path));
    rmSync(path);
    writeFileSync(path, '{"schema":1}', { mode: 0o600 });
    assert.throws(() => openRemoteAuditStore(path), /Truncated audit record/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

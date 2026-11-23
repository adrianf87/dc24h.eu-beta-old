import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPasskeyStore } from "../server/remote-passkeys.ts";
import { passkeyCeremonies, relyingParty } from "../server/remote-webauthn.ts";

function withStore(fn: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "dc24h-passkey-"));
  chmodSync(dir, 0o700);
  try { fn(join(dir, "passkeys.json")); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const sample = (id: string, actor = "7") => ({
  id, actor, userHandle: "a".repeat(43), publicKey: "b".repeat(60),
  counter: 0, deviceType: "singleDevice" as const, backedUp: false,
  transports: ["internal"], name: "Passkey", createdAt: 1000,
  lastUsedAt: null, revokedAt: null,
});

test("private file catalogs are bounded, reusable after restart, and require an exact RP ID", () => withStore(path => {
  const first = openPasskeyStore(path, "localhost");
  const handle = first.userHandle("7");
  assert.match(handle, /^[A-Za-z0-9_-]{43}$/);
  first.add({ ...sample("c".repeat(32)), userHandle: handle });
  assert.equal(first.forActor("7").length, 1);
  const restarted = openPasskeyStore(path, "localhost");
  assert.equal(restarted.userHandle("7"), handle);
  assert.equal(restarted.get("8", "c".repeat(32)), undefined);
  assert.throws(() => openPasskeyStore(path, "example.org"), /Invalid passkey catalog/);
  assert.throws(() => first.add({ ...sample("c".repeat(32)), userHandle: handle }), /duplicate/);
  assert.ok(!readFileSync(path, "utf8").includes("privateKey"));
}));

test("revocation invalidates the actor epoch and permanently rejects revoked keys", () => withStore(path => {
  const store = openPasskeyStore(path, "localhost");
  const id = "f".repeat(32), handle = store.userHandle("7");
  store.add({ ...sample(id), userHandle: handle });
  assert.equal(store.markUsed("7", id, 0, 1, "singleDevice", false, 2000), true);
  assert.equal(store.markUsed("7", id, 0, 2, "singleDevice", false, 2001), false);
  assert.equal(store.markUsed("7", id, 1, 1, "singleDevice", false, 2001), false);
  assert.equal(store.markUsed("7", id, 1, 2, "singleDevice", false, 2002), true);
  assert.equal(store.rename("8", id, "Stolen"), false);
  assert.equal(store.rename("7", id, "<script>"), false);
  assert.equal(store.rename("7", id, " My laptop "), true);
  assert.equal(store.get("7", id)?.name, "My laptop");
  assert.equal(store.epoch("7"), 0);
  assert.equal(store.revoke("7", id, 3000), true);
  assert.equal(store.epoch("7"), 1);
  assert.equal(store.forActor("7").length, 0);
  assert.equal(store.markUsed("7", id, 2, 3, "singleDevice", false, 3001), false);
  assert.equal(store.revoke("7", id, 3001), false);
  assert.equal(openPasskeyStore(path, "localhost").epoch("7"), 1);
  assert.equal(store.revokeAll("7", 3002), 0);
}));

test("external rewrite, unsafe permissions, corrupt data or another writer fail closed", () => withStore(path => {
  const store = openPasskeyStore(path, "localhost");
  store.userHandle("7");
  const competing = openPasskeyStore(path, "localhost");
  competing.userHandle("8");
  assert.equal(store.healthy(), false, "other process must not reuse stale cached credentials");
  assert.throws(() => store.forActor("7"), /unavailable/);
  chmodSync(path, 0o644);
  assert.throws(() => openPasskeyStore(path, "localhost"), /Unsafe/);
  chmodSync(path, 0o600);
  writeFileSync(path, "{\"schema\":1}");
  assert.throws(() => openPasskeyStore(path, "localhost"), /Invalid passkey catalog/);
}));

test("WebAuthn RP configuration does not trust browser Host or forwarded origin", () => {
  assert.deepEqual(relyingParty("https://localhost:8443", "localhost"),
    { origin: "https://localhost:8443", rpID: "localhost" });
  for (const [origin, rpID] of [
    ["http://localhost:8443", "localhost"], ["https://localhost:8443", "evil.test"],
    ["https://localhost:8443/path", "localhost"], ["https://u:p@localhost:8443", "localhost"],
  ]) assert.throws(() => relyingParty(origin!, rpID!), /RP ID/);
  withStore(path => {
    const ceremonies = passkeyCeremonies(openPasskeyStore(path, "localhost"), "https://localhost:8443", "localhost");
    assert.equal(typeof ceremonies.beginEnrollment, "function");
  });
});

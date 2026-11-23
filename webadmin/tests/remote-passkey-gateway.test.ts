import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { remoteGateway } from "../server/remote-gateway.ts";
import { openPasskeyStore } from "../server/remote-passkeys.ts";
import type { PasskeyCeremonies } from "../server/remote-webauthn.ts";
import { ACCESS_ROUTES } from "../src/lib/access.ts";
import { PERMISSION_KEYS } from "../src/lib/roles.ts";
import { snapshot } from "./fixtures.ts";

test("passkey gateway binds login and enrollment to one-use challenges, password authority, Origin, CSRF, and revocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dc24h-passkey-gateway-")); chmodSync(dir, 0o700);
  try {
    const store = openPasskeyStore(join(dir, "passkeys.json"), "localhost");
    const handle = store.userHandle("7");
    const id = "p".repeat(32);
    store.add({ id, actor: "7", userHandle: handle, publicKey: "q".repeat(60), counter: 0,
      deviceType: "multiDevice", backedUp: false, transports: [], name: "Phone",
      createdAt: 10, lastUsedAt: null, revokedAt: null });
    const ceremonies = {
      beginLogin: async () => ({ challenge: "passkey-challenge", allowCredentials: [{ id }] }),
      finishLogin: async (_actor: string, challenge: string, response: { valid: boolean }) =>
        challenge === "passkey-challenge" && response.valid,
      beginEnrollment: async () => ({ challenge: "enrollment-challenge", rp: { id: "localhost" } }),
      finishEnrollment: async (_actor: string, challenge: string, response: { valid: boolean }, now: number,
        beforePersist: () => Promise<boolean>) => {
        if (challenge !== "enrollment-challenge" || !response.valid || !await beforePersist()) return false;
        store.add({ id: "z".repeat(32), actor: "7", userHandle: handle, publicKey: "q".repeat(60),
          counter: 0, deviceType: "singleDevice", backedUp: false, transports: [],
          name: "Passkey", createdAt: now, lastUsedAt: null, revokedAt: null });
        return true;
      },
    } as unknown as PasskeyCeremonies;
    const events: string[] = [], called: string[] = [];
    let now = 100_000;
    const gateway = remoteGateway({ socket: "/private/test.sock", token: "a".repeat(64) }, {
      origin: "https://localhost:8443", now: () => now,
      passkeys: { store, ceremonies }, strictAudit: true, auditHealthy: () => true,
      audit: (event) => { events.push(event); },
      upstream: async (_cfg, path, method, body) => {
        called.push(method + " " + path);
        if (path === "/api/v1/admin/access") {
          const form = new URLSearchParams(body);
          if (form.get("actor_id") !== "7" || form.get("proof") !== "correct")
            throw Object.assign(Error(), { status: 403 });
          return { maintenance: true, restart_required: true, expires_in: 600,
            actor: { id: "7", role: "owner", status: "active" },
            grant: "b".repeat(64), session: "c".repeat(32), csrf: "d".repeat(64),
            permissions: PERMISSION_KEYS.map(key => ({ key, granted: true,
              implemented: key !== "configuration.manage" })),
            routes: ACCESS_ROUTES.map(([verb, target, permission]) => ({
              method: verb, path: target, permission, allowed: true })),
          };
        }
        if (path === "/api/v1/management") return {
          schema: 2, maintenance: true, restart_required: true,
          areas: ["accounts", "roles", "bans", "configuration", "hub"].map(key => ({
            key, permission: key === "accounts" ? "accounts.manage" : key === "roles" ? "roles.manage" :
              key === "bans" ? "users.ban+blocks.manage" : key === "hub" ? "hub.manage" : "configuration.manage",
            implemented: key !== "configuration", allowed: true,
          })),
        };
        if (path === "/api/v1/status") return snapshot;
        throw Error("unexpected private route");
      },
    });
    const call = async (name: string, method = "GET", data: unknown = {}, extra: Record<string, string> = {}) => {
      const body = method === "POST" ? JSON.stringify(data) : "";
      const headers: Record<string, string> = { host: "localhost", ...method === "POST" ? {
        origin: "https://localhost:8443", "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      } : {}, ...extra };
      const req = { method, url: "/remote/v1/" + name, headers,
        socket: { remoteAddress: "127.0.0.1" },
        async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); },
      } as unknown as IncomingMessage;
      const result = { status: 0, body: "", cookies: [] as string[] };
      const res = { writableEnded: false, destroyed: false,
        writeHead(status: number, responseHeaders: Record<string, unknown>) {
          result.status = status;
          result.cookies = responseHeaders["Set-Cookie"] as string[] ?? [];
        },
        end(text: string) { result.body = text; },
      } as unknown as ServerResponse;
      await gateway(req, res);
      return result;
    };
    const csrfHeader = (csrf: string, cookie: string) => ({ cookie,
      "x-dc24h-remote-csrf": csrf });
    const start = await call("challenge");
    const init = start.cookies[0]!.split(";")[0]!;
    const csrf = JSON.parse(start.body).csrf as string;
    assert.equal((await call("passkey/login/options", "POST", { actor_id: "7", password: "correct" },
      { cookie: init })).status, 403, "missing challenge header");
    assert.equal((await call("passkey/login/options", "POST", { actor_id: "7", password: "correct" },
      csrfHeader(csrf, init))).status, 403, "challenge consumed even when malformed");
    const challenge = await call("challenge");
    const csrf2 = JSON.parse(challenge.body).csrf as string;
    const options = await call("passkey/login/options", "POST", { actor_id: "7", password: "correct" },
      csrfHeader(csrf2, challenge.cookies[0]!.split(";")[0]!));
    assert.equal(options.status, 200);
    assert.equal(JSON.parse(options.body).challenge, "passkey-challenge");
    const pendingCookie = options.cookies[0]!.split(";")[0]!;
    assert.equal((await call("passkey/login/finish", "POST", { response: { valid: false } },
      csrfHeader(csrf2, pendingCookie))).status, 403);
    assert.equal((await call("passkey/login/finish", "POST", { response: { valid: true } },
      csrfHeader(csrf2, pendingCookie))).status, 403, "replayed finish refused");
    const next = await call("challenge");
    const csrf3 = JSON.parse(next.body).csrf as string;
    const second = await call("passkey/login/options", "POST", { actor_id: "7", password: "correct" },
      csrfHeader(csrf3, next.cookies[0]!.split(";")[0]!));
    const pending2 = second.cookies[0]!.split(";")[0]!;
    assert.equal((await call("passkey/login/finish", "POST", { response: { valid: true } },
      csrfHeader(csrf3, pending2.replace("passkey=", "passkey=bad")))).status, 403);
    const thirdStart = await call("challenge");
    const csrf4 = JSON.parse(thirdStart.body).csrf as string;
    const third = await call("passkey/login/options", "POST", { actor_id: "7", password: "correct" },
      csrfHeader(csrf4, thirdStart.cookies[0]!.split(";")[0]!));
    const approved = await call("passkey/login/finish", "POST", { response: { valid: true } },
      csrfHeader(csrf4, third.cookies[0]!.split(";")[0]!));
    assert.equal(approved.status, 200);
    assert.ok(events.includes("passkey_login_ok"));
    const sessionCookie = approved.cookies[0]!.split(";")[0]!;
    const sessionCsrf = JSON.parse(approved.body).csrf as string;
    assert.equal((await call("passkey/devices", "GET", {}, { cookie: sessionCookie })).status, 200);
    assert.equal((await call("passkey/enroll/options", "POST", {}, { cookie: sessionCookie })).status, 403);
    const enroll = await call("passkey/enroll/options", "POST", {}, csrfHeader(sessionCsrf, sessionCookie));
    assert.equal(enroll.status, 200);
    assert.equal((await call("passkey/enroll/finish", "POST", { response: { valid: true } },
      csrfHeader(sessionCsrf, sessionCookie))).status, 200);
    assert.equal(store.forActor("7").length, 2);
    assert.equal((await call("passkey/enroll/finish", "POST", { response: { valid: true } },
      csrfHeader(sessionCsrf, sessionCookie))).status, 403);
    assert.equal((await call("passkey/device/revoke", "POST", { id },
      csrfHeader(sessionCsrf, sessionCookie))).status, 200);
    assert.equal(store.epoch("7"), 1);
    assert.equal((await call("session", "GET", {}, { cookie: sessionCookie })).status, 401);
    assert.equal(store.forActor("7").length, 1);
    assert.ok(called.includes("POST /api/v1/admin/access"));
    assert.ok(events.includes("passkey_revoke_intent") && events.includes("passkey_revoked"));
    now += 61_000;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

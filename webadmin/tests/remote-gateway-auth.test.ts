import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { remoteGateway } from "../server/remote-gateway.ts";
import { PERMISSION_KEYS } from "../src/lib/roles.ts";
import { ACCESS_ROUTES } from "../src/lib/access.ts";
import { snapshot } from "./fixtures.ts";

const origin = "https://localhost:8443";
const token = "a".repeat(64);
const grant = "b".repeat(64);
const apiSession = "c".repeat(32);
const apiCsrf = "d".repeat(64);
type Failure = Error & { status?: number };
const failure = (status: number): Failure => Object.assign(new Error("private_failure"), { status });

function harness(mfaConfigured = true, strictAudit = false) {
  let time = 100_000;
  const calls: string[] = [];
  const events: string[] = [];
  const state = {
    role: "administrator", actor: "7", active: true, allowed: true,
    loginFailure: 0, managementFailure: 0,
    mfaAccepted: true, mfaFailure: false,
    auditHealthy: true, auditFailure: false,
    managementGate: async () => {},
    statusResponse: async () => snapshot as unknown,
  };
  const gateway = remoteGateway({ socket: "/private/test-only.sock", token }, {
    origin, now: () => time,
    strictAudit, auditHealthy: () => state.auditHealthy,
    audit: (event) => {
      events.push(event);
      if (state.auditFailure && event === "login_ok") throw new Error("audit_write_failed");
    },
    ...(mfaConfigured ? { mfaVerify: (_actor: string, code: string) => {
      if (state.mfaFailure) throw Error("private_mfa_failure");
      return state.mfaAccepted && code === "000000";
    } } : {}),
    upstream: async (_config, path, method, body, session) => {
      calls.push(method + " " + path);
      if (path === "/api/v1/admin/access") {
        if (state.loginFailure) throw failure(state.loginFailure);
        const form = new URLSearchParams(body);
        if (form.get("actor_id") !== "7" || form.get("proof") !== "correct") throw failure(403);
        return {
          maintenance: true, restart_required: true, expires_in: 600,
          actor: { id: state.actor, role: state.role, status: state.active ? "active" : "disabled" },
          grant, session: apiSession, csrf: apiCsrf,
          permissions: PERMISSION_KEYS.map((key) => ({
            key, granted: true, implemented: key !== "configuration.manage",
          })),
          routes: ACCESS_ROUTES.map(([verb, target, permission]) => ({
            method: verb, path: target, permission, allowed: true,
          })),
        };
      }
      if (path === "/api/v1/management") {
        await state.managementGate();
        assert.equal(session?.grant, grant);
        assert.equal(session?.apiSession, apiSession);
        assert.equal(session?.apiCsrf, apiCsrf);
        if (state.managementFailure) throw failure(state.managementFailure);
        return {
          schema: 2, maintenance: true, restart_required: true,
          areas: [
            { key: "accounts", permission: "accounts.manage", implemented: true, allowed: state.allowed },
            { key: "roles", permission: "roles.manage", implemented: true, allowed: state.allowed },
            { key: "bans", permission: "users.ban+blocks.manage", implemented: true, allowed: state.allowed },
            { key: "configuration", permission: "configuration.manage", implemented: false, allowed: state.allowed },
            { key: "hub", permission: "hub.manage", implemented: true, allowed: state.allowed },
          ],
        };
      }
      if (path === "/api/v1/status") return state.statusResponse();
      throw new Error("unexpected_private_route");
    },
  });
  async function call(path: string, method = "GET", body = "", extra: Record<string, string> = {}, bodyGate?: Promise<void>) {
    const headers = {
      host: "localhost",
      ...(method === "POST" ? {
        origin, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)),
      } : {}),
      ...extra,
    };
    const req = {
      url: path, method, headers, socket: { remoteAddress: "127.0.0.1" },
      async *[Symbol.asyncIterator]() { if (body) { if (bodyGate) await bodyGate; yield Buffer.from(body); } },
    } as unknown as IncomingMessage;
    const response: { status: number; body: string; cookies: string[] } = { status: 0, body: "", cookies: [] };
    const res = {
      writableEnded: false, destroyed: false,
      writeHead(status: number, headers: Record<string, unknown>) {
        response.status = status;
        if (Array.isArray(headers["Set-Cookie"])) response.cookies = headers["Set-Cookie"] as string[];
      },
      end(body: string) { response.body = body; },
    } as unknown as ServerResponse;
    await gateway(req, res);
    return response;
  }
  async function login(actor = "7", password = "correct", priorCookie = "", otp = "000000") {
    const issued = await call("/remote/v1/challenge");
    assert.equal(issued.status, 200);
    const challenge = JSON.parse(issued.body).csrf as string;
    const body = JSON.stringify({ actor_id: actor, password, otp });
    return call("/remote/v1/login", "POST", body, {
      cookie: issued.cookies[0]!.split(";")[0]! + (priorCookie ? "; " + priorCookie : ""),
      "x-dc24h-remote-csrf": challenge,
    });
  }
  return { state, calls, events, call, login, advance: (milliseconds: number) => { time += milliseconds; } };
}

test("login accepts current administrator and Owner, but never substitutes an actor", async () => {
  for (const role of ["administrator", "owner"]) {
    const h = harness();
    h.state.role = role;
    const login = await h.login();
    assert.equal(login.status, 200, role);
    assert.equal(JSON.parse(login.body).mfa, true);
    assert.ok(h.events.includes("mfa_ok"));
    assert.ok(login.cookies[0]?.includes("HttpOnly; Secure; SameSite=Strict"));
    assert.ok(!login.body.includes(grant) && !login.body.includes(apiSession) && !login.body.includes("correct"));
    assert.deepEqual(h.calls, ["POST /api/v1/admin/access", "GET /api/v1/management"]);
  }
  for (const change of [
    (h: ReturnType<typeof harness>) => { h.state.actor = "8"; },
    (h: ReturnType<typeof harness>) => { h.state.role = "operator"; },
    (h: ReturnType<typeof harness>) => { h.state.active = false; },
    (h: ReturnType<typeof harness>) => { h.state.allowed = false; },
  ]) {
    const h = harness();
    change(h);
    const refused = await h.login();
    assert.equal(refused.status, 403);
    assert.equal(refused.body, '{"error":"login_refused"}');
    assert.ok(!h.calls.includes("GET /api/v1/status"));
    assert.ok(!refused.body.includes("correct"));
  }
});

test("MFA is required after private access authorization and is audited without leaking codes", async () => {
  for (const [accepted, failure, expected] of [[false, false, 403], [true, true, 503]] as const) {
    const h = harness();
    h.state.mfaAccepted = accepted;
    h.state.mfaFailure = failure;
    const response = await h.login();
    assert.equal(response.status, expected);
    assert.deepEqual(h.calls, ["POST /api/v1/admin/access", "GET /api/v1/management"]);
    assert.ok(!response.cookies.some((item) => item.startsWith("dc24h_remote=")));
    assert.ok(!JSON.stringify(h.events).includes("000000"));
    if (!failure) assert.ok(h.events.includes("mfa_refused"));
  }
  const absent = harness(false);
  assert.equal((await absent.login()).status, 503, "no configured verifier cannot mint a session");
  const invalid = harness();
  assert.equal((await invalid.login("7", "correct", "", "123456")).status, 403);
  assert.ok(invalid.events.includes("mfa_refused"));
});

test("strict durable audit refuses successful logins on missing records and revokes sessions after sink loss", async () => {
  const fail = harness(true, true);
  fail.state.auditFailure = true;
  const denied = await fail.login();
  assert.equal(denied.status, 503);
  assert.equal(denied.body, '{"error":"unavailable"}');
  assert.ok(!denied.cookies.some(c => c.startsWith("dc24h_remote=")));
  const healthy = harness(true, true);
  const accepted = await healthy.login();
  assert.equal(accepted.status, 200);
  const cookie = accepted.cookies[0]!.split(";")[0]!;
  healthy.state.auditHealthy = false;
  assert.equal((await healthy.call("/remote/v1/summary", "GET", "", { cookie })).status, 503);
  healthy.state.auditHealthy = true;
  assert.equal((await healthy.call("/remote/v1/summary", "GET", "", { cookie })).status, 401,
    "an unhealthy audit sink revokes all existing browser sessions");
});

test("bad passwords, unknown accounts and lost API return generic refusals", async () => {
  for (const [actor, password] of [["7", "bad"], ["8", "correct"]]) {
    const h = harness();
    const refused = await h.login(actor, password);
    assert.equal(refused.status, 403);
    assert.equal(refused.body, '{"error":"login_refused"}');
    assert.equal(h.calls.includes("GET /api/v1/status"), false);
  }
  for (const code of [401, 403, 404, 503]) {
    const h = harness();
    h.state.loginFailure = code;
    const refused = await h.login();
    assert.equal(refused.status, code === 503 ? 503 : 403);
    assert.equal(refused.body, code === 503 ? '{"error":"unavailable"}' : '{"error":"login_refused"}');
  }
});

test("every protected read rechecks permissions and denies a revoked grant or reduced role", async () => {
  for (const revokedStatus of [0, 401, 403, 404]) {
    const h = harness();
    const login = await h.login();
    assert.equal(login.status, 200);
    const cookie = login.cookies[0]!.split(";")[0]!;
    assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 200);
    assert.equal((await h.call("/remote/v1/summary", "GET", "", { cookie })).status, 200);
    const before = h.calls.filter((call) => call === "GET /api/v1/status").length;
    if (revokedStatus) h.state.managementFailure = revokedStatus;
    else h.state.allowed = false;
    const refused = await h.call("/remote/v1/summary", "GET", "", { cookie });
    assert.equal(refused.status, 403);
    assert.equal(refused.body, '{"error":"forbidden"}');
    assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 401);
    assert.equal(h.calls.filter((call) => call === "GET /api/v1/status").length, before);
    assert.ok(h.events.includes("session_revoked"));
  }
});

test("API outages deny session and summary reads without cached metrics", async () => {
  const h = harness();
  const login = await h.login();
  const cookie = login.cookies[0]!.split(";")[0]!;
  h.state.managementFailure = 503;
  for (const name of ["session", "summary"]) {
    const refused = await h.call("/remote/v1/" + name, "GET", "", { cookie });
    assert.equal(refused.status, 503);
    assert.equal(refused.body, '{"error":"unavailable"}');
  }
  assert.equal(h.calls.includes("GET /api/v1/status"), false);
  assert.ok(h.events.includes("api_unavailable"));
});

test("remote status strips private upstream fields and refuses malformed or unavailable statistics", async () => {
  const h = harness();
  const login = await h.login();
  const browserCookie = login.cookies[0]!.split(";")[0]!;
  const privateValue = "SECRET_IDENTITY_FROM_PRIVATE_API";
  const clean = { ...snapshot, server: { ...snapshot.server, version: "beta-0.4.6" } };
  h.state.statusResponse = async () => ({
    ...clean, secret: privateValue, audit_rows: [{ account: privateValue }],
    server: { ...clean.server, private_socket: privateValue },
    users: { ...clean.users, nick: privateValue, cid: privateValue, ip: privateValue },
    chat: { ...clean.chat, message: privateValue },
    dashboard: { malformed: privateValue }, monitoring: { secret: privateValue },
    configuration: { token: privateValue },
    search: { statistics: { queries_received: 8, results_received: 9, cid: privateValue }, configuration: { token: privateValue } },
    transfers: { statistics: { ctm_received: 10, rcm_received: 11, address: privateValue }, configuration: privateValue },
  });
  const safe = await h.call("/remote/v1/summary", "GET", "", { cookie: browserCookie });
  assert.equal(safe.status, 200);
  assert.deepEqual(JSON.parse(safe.body), {
    schema: 1, mode: "read-only",
    server: { version: "beta-0.4.6", running: true, uptime_seconds: 3661 },
    network: { active_connections: 7, accepted_connections: 48 },
    users: { online: 4, peak_online: 6 },
    chat: { received: 12, rejected: 2 },
    search: { queries: 8, results: 9 }, transfers: { ctm: 10, rcm: 11 },
  });
  assert.ok(!safe.body.includes(privateValue));

  for (const bad of [
    { ...clean, api_version: "v2" },
    { ...clean, chat: { ...clean.chat, received: Number.MAX_SAFE_INTEGER + 1 } },
    { ...clean, server: { ...clean.server, version: privateValue } },
    { ...clean, search: { statistics: { queries_received: "8", results_received: 9 } } },
    { ...clean, network: undefined },
  ]) {
    h.state.statusResponse = async () => bad;
    const denied = await h.call("/remote/v1/summary", "GET", "", { cookie: browserCookie });
    assert.equal(denied.status, 503);
    assert.equal(denied.body, '{"error":"unavailable"}');
    assert.ok(!denied.body.includes(privateValue));
  }
  h.state.statusResponse = async () => { throw new Error(privateValue); };
  const outage = await h.call("/remote/v1/summary", "GET", "", { cookie: browserCookie });
  assert.equal(outage.status, 503);
  assert.equal(outage.body, '{"error":"unavailable"}');
  h.state.statusResponse = async () => clean;
  assert.equal((await h.call("/remote/v1/summary", "GET", "", { cookie: browserCookie })).status, 200);
});

test("a revoked session cannot finish an earlier in-flight status read", async () => {
  const h = harness();
  const login = await h.login();
  const cookie = login.cookies[0]!.split(";")[0]!;
  let releaseStatus!: (value: unknown) => void;
  let started!: () => void;
  const statusStarted = new Promise<void>((resolve) => { started = resolve; });
  h.state.statusResponse = () => new Promise<unknown>((resolve) => { releaseStatus = resolve; started(); });
  const pending = h.call("/remote/v1/summary", "GET", "", { cookie });
  await statusStarted;
  h.state.allowed = false;
  const revoked = await h.call("/remote/v1/session", "GET", "", { cookie });
  assert.equal(revoked.status, 403);
  releaseStatus(snapshot);
  const stale = await pending;
  assert.equal(stale.status, 403);
  assert.ok(!stale.body.includes("uptime_seconds"));
  assert.equal((await h.call("/remote/v1/summary", "GET", "", { cookie })).status, 401);
});

test("evicting the oldest browser session cancels its outstanding status response", async () => {
  const h = harness();
  const logins = [];
  for (let i = 0; i < 4; i++) logins.push(await h.login());
  assert.ok(logins.every((result) => result.status === 200));
  const oldest = logins[0]!.cookies[0]!.split(";")[0]!;
  let releaseStatus!: (value: unknown) => void;
  let signalStatus!: () => void;
  const statusStarted = new Promise<void>((resolve) => { signalStatus = resolve; });
  h.state.statusResponse = () => new Promise<unknown>((resolve) => {
    releaseStatus = resolve;
    signalStatus();
  });
  const stale = h.call("/remote/v1/summary", "GET", "", { cookie: oldest });
  await statusStarted;
  h.advance(60_001); // Roll over the login budget, not the browser session.
  assert.equal((await h.login()).status, 200, "the fifth session evicts the oldest");
  releaseStatus(snapshot);
  const result = await stale;
  assert.equal(result.status, 403);
  assert.ok(!result.body.includes("uptime_seconds"));
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: oldest })).status, 401);
});

test("status cannot expose metrics when access is revoked while the upstream read is in flight", async () => {
  const h = harness();
  const login = await h.login();
  const cookie = login.cookies[0]!.split(";")[0]!;
  let releaseStatus!: (value: unknown) => void;
  let started!: () => void;
  const statusStarted = new Promise<void>((resolve) => { started = resolve; });
  h.state.statusResponse = () => new Promise<unknown>((resolve) => {
    releaseStatus = resolve;
    started();
  });

  const pending = h.call("/remote/v1/summary", "GET", "", { cookie });
  await statusStarted;
  // No concurrent browser request forces a session recheck or deletes it.
  // The upstream may revoke the grant while the status API is still running.
  h.state.allowed = false;
  releaseStatus(snapshot);

  const denied = await pending;
  assert.equal(denied.status, 403);
  assert.equal(denied.body, '{"error":"forbidden"}');
  assert.ok(!denied.body.includes("uptime_seconds"));
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 401);
});

test("a management outage during a status read never falls back to stale metrics", async () => {
  const h = harness();
  const login = await h.login();
  const cookie = login.cookies[0]!.split(";")[0]!;
  let releaseStatus!: (value: unknown) => void;
  let started!: () => void;
  const statusStarted = new Promise<void>((resolve) => { started = resolve; });
  h.state.statusResponse = () => new Promise<unknown>((resolve) => {
    releaseStatus = resolve;
    started();
  });

  const pending = h.call("/remote/v1/summary", "GET", "", { cookie });
  await statusStarted;
  h.state.managementFailure = 503;
  releaseStatus(snapshot);

  const denied = await pending;
  assert.equal(denied.status, 503);
  assert.equal(denied.body, '{"error":"unavailable"}');
  assert.ok(!denied.body.includes("uptime_seconds"));
});

test("parallel status reads all fail closed after mid-flight revocation and recover after fresh login", async () => {
  const h = harness();
  const login = await h.login();
  const cookie = login.cookies[0]!.split(";")[0]!;
  const count = 12;
  let started = 0;
  let signalAll!: () => void;
  let releaseStatus!: () => void;
  const allStarted = new Promise<void>((resolve) => { signalAll = resolve; });
  const statusGate = new Promise<void>((resolve) => { releaseStatus = resolve; });
  h.state.statusResponse = async () => {
    if (++started === count) signalAll();
    await statusGate;
    return snapshot;
  };
  const pending = Array.from({ length: count }, () => h.call("/remote/v1/summary", "GET", "", { cookie }));
  await allStarted;
  h.state.allowed = false;
  releaseStatus();
  const results = await Promise.all(pending);
  assert.ok(results.every((result) => result.status === 403 && result.body === '{"error":"forbidden"}'));
  assert.ok(results.every((result) => !result.body.includes("uptime_seconds")));
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 401);
  h.state.allowed = true;
  const recovered = await h.login();
  assert.equal(recovered.status, 200);
  assert.equal((await h.call("/remote/v1/summary", "GET", "", {
    cookie: recovered.cookies[0]!.split(";")[0]!,
  })).status, 200);
});

test("login limiter caps password checks for a single actor", async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) {
    const result = await h.login("7", "wrong");
    assert.equal(result.status, i < 4 ? 403 : 429);
  }
  assert.equal(h.calls.filter((call) => call === "POST /api/v1/admin/access").length, 4);
  assert.equal(h.calls.includes("GET /api/v1/status"), false);
});

test("bounded burst of login and anonymous requests cannot bypass rate limits or expose the API", async () => {
  // Deterministic in-process pressure test, never an external load generator.
  const h = harness();
  const attempted = await Promise.all(Array.from({ length: 16 }, () => h.login()));
  assert.equal(attempted.filter((response) => response.status === 200).length, 4);
  assert.equal(attempted.filter((response) => response.status === 429).length, 12);
  assert.equal(h.calls.filter((item) => item === "POST /api/v1/admin/access").length, 4);
  const cookies = attempted.filter((response) => response.status === 200)
    .map((response) => response.cookies[0]!.split(";")[0]!);
  assert.equal(new Set(cookies).size, 4);
  const responses = await Promise.all(Array.from({ length: 128 }, (_, index) =>
    h.call(index % 2 ? "/remote/v1/summary" : "/remote/v1/not-allowed")));
  assert.equal(responses.filter((response) => response.status === 401).length, 64);
  assert.equal(responses.filter((response) => response.status === 404).length, 64);
  assert.ok(responses.every((response) => !response.body.includes(grant) && !response.body.includes(apiCsrf)));
  assert.equal(h.calls.filter((item) => item === "GET /api/v1/status").length, 0);
  for (const cookie of cookies) {
    assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 200);
  }
});

test("64 simultaneous failed status reads return no stale data and recover after API restoration", async () => {
  const h = harness();
  const issued = await h.login();
  const cookie = issued.cookies[0]!.split(";")[0]!;
  const count = 64;
  let started = 0;
  let signalAll!: () => void;
  let release!: () => void;
  const allStarted = new Promise<void>((resolve) => { signalAll = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  h.state.statusResponse = async () => {
    if (++started === count) signalAll();
    await gate;
    throw new Error("PRIVATE_DATABASE_FAILURE_DO_NOT_LEAK");
  };
  const pending = Array.from({ length: count }, () =>
    h.call("/remote/v1/summary", "GET", "", { cookie }));
  await allStarted;
  release();
  const results = await Promise.all(pending);
  assert.ok(results.every((response) => response.status === 503 && response.body === '{"error":"unavailable"}'));
  assert.ok(results.every((response) => !response.body.includes("PRIVATE_DATABASE_FAILURE_DO_NOT_LEAK")));
  h.state.statusResponse = async () => snapshot;
  assert.equal((await h.call("/remote/v1/summary", "GET", "", { cookie })).status, 200);
  assert.ok(h.events.includes("api_unavailable"));
});

test("an expired challenge cannot be used by completing a slow login body", async () => {
  const h = harness();
  const issued = await h.call("/remote/v1/challenge");
  assert.equal(issued.status, 200);
  const body = JSON.stringify({ actor_id: "7", password: "correct", otp: "000000" });
  let finishBody!: () => void;
  const bodyGate = new Promise<void>((resolve) => { finishBody = resolve; });
  const pending = h.call("/remote/v1/login", "POST", body, {
    cookie: issued.cookies[0]!.split(";")[0]!,
    "x-dc24h-remote-csrf": (JSON.parse(issued.body) as { csrf: string }).csrf,
  }, bodyGate);
  h.advance(120_001);
  finishBody();
  const result = await pending;
  assert.equal(result.status, 403);
  assert.equal(result.body, '{"error":"login_refused"}');
  assert.equal(h.calls.includes("POST /api/v1/admin/access"), false);
});

test("a session expiring during a delayed status request cannot return protected metrics", async () => {
  const h = harness();
  const login = await h.login();
  assert.equal(login.status, 200);
  const sessionCookie = login.cookies[0]!.split(";")[0]!;
  let releaseStatus!: (value: unknown) => void;
  let signalStarted!: () => void;
  const statusStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
  h.state.statusResponse = () => new Promise<unknown>((resolve) => {
    releaseStatus = resolve;
    signalStarted();
  });
  const pending = h.call("/remote/v1/summary", "GET", "", { cookie: sessionCookie });
  await statusStarted;
  h.advance(600_001);
  releaseStatus(snapshot);
  const result = await pending;
  assert.equal(result.status, 401);
  assert.equal(result.body, '{"error":"unauthorized"}');
  assert.ok(!result.body.includes("uptime_seconds"));
});

test("a session expiring during authorization cannot renew its idle deadline", async () => {
  const h = harness();
  const login = await h.login();
  assert.equal(login.status, 200);
  const sessionCookie = login.cookies[0]!.split(";")[0]!;
  let releaseAuth!: () => void;
  let signalStarted!: () => void;
  const authStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
  h.state.managementGate = () => new Promise<void>((resolve) => {
    releaseAuth = resolve;
    signalStarted();
  });
  const pending = h.call("/remote/v1/session", "GET", "", { cookie: sessionCookie });
  await authStarted;
  h.advance(120_001);
  releaseAuth();
  const result = await pending;
  assert.equal(result.status, 401);
  assert.equal(result.body, '{"error":"unauthorized"}');
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: sessionCookie })).status, 401);
});

test("a successful re-login rotates the browser session and refuses the previous cookie", async () => {
  const h = harness();
  const initial = await h.login();
  assert.equal(initial.status, 200);
  const oldCookie = initial.cookies[0]!.split(";")[0]!;
  const failed = await h.login("7", "wrong", oldCookie);
  assert.equal(failed.status, 403);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: oldCookie })).status, 200);
  const renewed = await h.login("7", "correct", oldCookie);
  assert.equal(renewed.status, 200);
  const nextCookie = renewed.cookies[0]!.split(";")[0]!;
  assert.notEqual(nextCookie, oldCookie);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: oldCookie })).status, 401);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: nextCookie })).status, 200);
});

test("a session created after delayed login authorization gets a fresh lifetime", async () => {
  const h = harness();
  let release!: () => void;
  let started!: () => void;
  const pendingAuth = new Promise<void>((resolve) => { started = resolve; });
  h.state.managementGate = () => new Promise<void>((resolve) => {
    release = resolve;
    started();
  });
  const pendingLogin = h.login();
  await pendingAuth;
  h.advance(600_001);
  h.state.managementGate = async () => {};
  release();
  const loggedIn = await pendingLogin;
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.cookies[0]!.split(";")[0]!;
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 200);
  h.advance(120_001);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 401);
});

test("browser sessions have independent CSRF tokens and logout revokes only its own cookie", async () => {
  const h = harness();
  const first = await h.login();
  const second = await h.login();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstCookie = first.cookies[0]!.split(";")[0]!;
  const secondCookie = second.cookies[0]!.split(";")[0]!;
  const firstCsrf = JSON.parse(first.body).csrf as string;
  const secondCsrf = JSON.parse(second.body).csrf as string;
  assert.notEqual(firstCookie, secondCookie);
  assert.notEqual(firstCsrf, secondCsrf);
  for (const response of [first, second]) {
    assert.match(response.cookies[0]!, /Path=\/remote\/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=600/);
  }
  const body = "{}";
  const wrongCsrf = await h.call("/remote/v1/logout", "POST", body, {
    cookie: firstCookie, "x-dc24h-remote-csrf": secondCsrf,
  });
  assert.equal(wrongCsrf.status, 403);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: firstCookie })).status, 200);
  const foreignOrigin = await h.call("/remote/v1/logout", "POST", body, {
    cookie: firstCookie, origin: "https://evil.example", "x-dc24h-remote-csrf": firstCsrf,
  });
  assert.equal(foreignOrigin.status, 403);
  const missingOrigin = await h.call("/remote/v1/logout", "POST", body, {
    cookie: firstCookie, origin: "", "x-dc24h-remote-csrf": firstCsrf,
  });
  assert.equal(missingOrigin.status, 403);
  const logout = await h.call("/remote/v1/logout", "POST", body, {
    cookie: firstCookie, "x-dc24h-remote-csrf": firstCsrf,
  });
  assert.equal(logout.status, 200);
  assert.match(logout.cookies[0]!, /Path=\/remote\/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=0/);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: firstCookie })).status, 401);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: secondCookie })).status, 200);
});

test("four sessions survive concurrent login, with oldest evicted on the fifth", async () => {
  const h = harness();
  const logins = await Promise.all(Array.from({ length: 4 }, () => h.login()));
  assert.ok(logins.every((result) => result.status === 200));
  const cookies = logins.map((result) => result.cookies[0]!.split(";")[0]!);
  assert.equal(new Set(cookies).size, 4);
  h.advance(60_001); // Reset the per-actor login budget, before the idle deadline.
  for (const cookie of cookies) {
    assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 200);
  }
  const fifth = await h.login();
  assert.equal(fifth.status, 200);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: cookies[0]! })).status, 401);
  for (const cookie of [...cookies.slice(1), fifth.cookies[0]!.split(";")[0]!]) {
    assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 200);
  }
});

test("an old cookie cannot be restored after a gateway process restart", async () => {
  const before = harness();
  const issued = await before.login();
  assert.equal(issued.status, 200);
  const oldCookie = issued.cookies[0]!.split(";")[0]!;
  const after = harness(); // In-memory sessions are intentionally never persisted.
  assert.equal((await after.call("/remote/v1/summary", "GET", "", { cookie: oldCookie })).status, 401);
  assert.equal(after.calls.length, 0);
});

test("absolute session lifetime expires at ten minutes despite regular activity", async () => {
  const h = harness();
  const result = await h.login();
  assert.equal(result.status, 200);
  const cookie = result.cookies[0]!.split(";")[0]!;
  for (let minute = 1; minute < 10; minute++) {
    h.advance(60_000);
    assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie })).status, 200);
  }
  h.advance(60_000);
  assert.equal((await h.call("/remote/v1/summary", "GET", "", { cookie })).status, 401);
  assert.equal(h.calls.includes("GET /api/v1/status"), false);
});

test("concurrent reuse of a login challenge authenticates at most once", async () => {
  const h = harness();
  const challenge = await h.call("/remote/v1/challenge");
  assert.equal(challenge.status, 200);
  const cookie = challenge.cookies[0]!.split(";")[0]!;
  const csrf = (JSON.parse(challenge.body) as { csrf: string }).csrf;
  const body = JSON.stringify({ actor_id: "7", password: "correct", otp: "000000" });
  const headers = { cookie, "x-dc24h-remote-csrf": csrf };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = h.call("/remote/v1/login", "POST", body, headers, gate);
  const replay = await h.call("/remote/v1/login", "POST", body, headers);
  assert.equal(replay.status, 403);
  release();
  assert.equal((await pending).status, 200);
  assert.equal(h.calls.filter((item) => item === "POST /api/v1/admin/access").length, 1);
});

test("logout denies a summary that is still waiting on the private API", async () => {
  const h = harness();
  const login = await h.login();
  const cookie = login.cookies[0]!.split(";")[0]!;
  const csrf = (JSON.parse(login.body) as { csrf: string }).csrf;
  let releaseStatus!: (value: unknown) => void;
  let signalStarted!: () => void;
  const statusStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
  h.state.statusResponse = () => new Promise<unknown>((resolve) => {
    releaseStatus = resolve;
    signalStarted();
  });
  const inFlight = h.call("/remote/v1/summary", "GET", "", { cookie });
  await statusStarted;
  const loggedOut = await h.call("/remote/v1/logout", "POST", "{}", {
    cookie, "x-dc24h-remote-csrf": csrf,
  });
  assert.equal(loggedOut.status, 200);
  releaseStatus(snapshot);
  const stale = await inFlight;
  assert.equal(stale.status, 403);
  assert.ok(!stale.body.includes("uptime_seconds"));
  assert.equal((await h.call("/remote/v1/summary", "GET", "", { cookie })).status, 401);
});

test("two concurrent re-logins cannot leave an orphaned session from one old cookie", async () => {
  const h = harness();
  const initial = await h.login();
  assert.equal(initial.status, 200);
  const oldCookie = initial.cookies[0]!.split(";")[0]!;
  const releases: Array<() => void> = [];
  let bothStarted!: () => void;
  const ready = new Promise<void>((resolve) => { bothStarted = resolve; });
  h.state.managementGate = () => new Promise<void>((resolve) => {
    releases.push(resolve);
    if (releases.length === 2) bothStarted();
  });
  const firstPending = h.login("7", "correct", oldCookie);
  const secondPending = h.login("7", "correct", oldCookie);
  await ready;
  h.state.managementGate = async () => {};
  releases[0]!();
  const first = await firstPending;
  assert.equal(first.status, 200);
  releases[1]!();
  const second = await secondPending;
  assert.equal(second.status, 403, "the second login must not outlive a replaced browser session");
  const activeCookie = first.cookies[0]!.split(";")[0]!;
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: oldCookie })).status, 401);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: activeCookie })).status, 200);
});

test("logout cancels an in-flight re-login tied to the same session", async () => {
  const h = harness();
  const initial = await h.login();
  const oldCookie = initial.cookies[0]!.split(";")[0]!;
  const oldCsrf = (JSON.parse(initial.body) as { csrf: string }).csrf;
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  h.state.managementGate = () => new Promise<void>((resolve) => {
    release = resolve;
    started();
  });
  const pending = h.login("7", "correct", oldCookie);
  await ready;
  h.state.managementGate = async () => {};
  const logout = await h.call("/remote/v1/logout", "POST", "{}", {
    cookie: oldCookie, "x-dc24h-remote-csrf": oldCsrf,
  });
  assert.equal(logout.status, 200);
  release();
  assert.equal((await pending).status, 403);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: oldCookie })).status, 401);
});

test("a delayed logout prevents a replacement login while its body is pending", async () => {
  const h = harness();
  const initial = await h.login();
  assert.equal(initial.status, 200);
  const oldCookie = initial.cookies[0]!.split(";")[0]!;
  const csrf = (JSON.parse(initial.body) as { csrf: string }).csrf;

  let finishBody!: () => void;
  const bodyGate = new Promise<void>((resolve) => { finishBody = resolve; });
  const pendingLogout = h.call("/remote/v1/logout", "POST", "{}", {
    cookie: oldCookie, "x-dc24h-remote-csrf": csrf,
  }, bodyGate);

  const invalidParallelLogout = await h.call("/remote/v1/logout", "POST", "{", {
    cookie: oldCookie, "x-dc24h-remote-csrf": csrf,
  });
  assert.equal(invalidParallelLogout.status, 400);
  const renewed = await h.login("7", "correct", oldCookie);
  assert.equal(renewed.status, 403, "an in-flight logout must prevent re-authentication");
  finishBody();

  const logout = await pendingLogout;
  assert.equal(logout.status, 200);
  assert.equal((await h.call("/remote/v1/session", "GET", "", { cookie: oldCookie })).status, 401);
  assert.equal(h.calls.filter((item) => item === "GET /api/v1/status").length, 0);
});

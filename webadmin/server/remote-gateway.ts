// A separate, loopback-only session gateway. Never mount this handler in Vite
// or in the public-facing WebAdmin adapter.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseAccess } from "../src/lib/access.ts";
import { parseManagement } from "../src/lib/management.ts";
import { parseRemoteSummary } from "../src/lib/status.ts";
import { isJsonContentType } from "./json-content-type.ts";
import type { PasskeyCeremonies } from "./remote-webauthn.ts";
import type { PasskeyStore } from "./remote-passkeys.ts";
export { isJsonContentType } from "./json-content-type.ts";

type Credentials = { socket: string; token: string };
export type RemoteEvent = "login_ok" | "login_refused" | "mfa_ok" | "mfa_refused" | "logout" | "session_revoked" | "route_refused" | "api_unavailable" |
  "passkey_enrolled" | "passkey_enroll_refused" | "passkey_login_ok" | "passkey_login_refused" |
  "passkey_device_renamed" | "passkey_revoke_intent" | "passkey_revoked" |
  "passkey_enroll_intent" | "passkey_recovery_intent" | "passkey_recovered";
export interface RemoteOptions {
  origin: string;
  now?: () => number;
  audit?: (event: RemoteEvent) => void;
  // The local operator can require synchronous durable writes before login.
  // A promise-based best-effort sink never satisfies strict audit mode.
  strictAudit?: boolean;
  auditHealthy?: () => boolean;
  // No login session can be created without an explicitly configured second factor.
  mfaVerify?: (actor: string, code: string, at: number) => boolean;
  // Only the isolated local gateway passes this pair, never Vite or the public API.
  passkeys?: { store: PasskeyStore; ceremonies: PasskeyCeremonies };
  // Optional in-process transport override for deterministic, socket-free tests.
  upstream?: typeof upstream;
}
type Session = {
  mfaVerified: true;
  actor: string;
  grant: string;
  apiSession: string;
  apiCsrf: string;
  csrf: string;
  created: number;
  used: number;
  pendingLogouts: number;
  passkeyEpoch: number;
};
type Challenge = { token: string; expires: number };
type PasskeyPending = { actor: string; session: Session; challenge: string; csrf: string;
  expires: number; oldKey: string; oldSession?: Session };
type Budget = { count: number; starts: number };

const prefix = "/remote/v1/";
const cookiePath = "/remote/v1";
const maxSessions = 4;
const idleTime = 2 * 60_000;
const absoluteTime = 10 * 60_000;
const challengeTime = 2 * 60_000;
const maxBody = 2048;
const maxCeremonyBody = 32768;
const passkeyPost = new Set(["passkey/login/options", "passkey/login/finish", "passkey/enroll/options",
  "passkey/enroll/finish", "passkey/device/rename", "passkey/device/revoke"]);
const safePath = new Set(["challenge", "login", "session", "summary", "logout", "passkey/devices", ...passkeyPost]);
const object = (data: unknown): Record<string, unknown> => {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid response");
  return data as Record<string, unknown>;
};
const sameSecret = (a: string, b: string): boolean =>
  /^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{64}$/.test(b) &&
  timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
const loopback = (peer: string | undefined): boolean =>
  peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
const untrustedProxyHeader = (req: IncomingMessage): boolean =>
  Object.keys(req.headers).some((name) =>
    name === "authorization" || name === "proxy" || name === "proxy-authorization" ||
    name === "forwarded" || name === "x-real-ip" || name === "x-original-url" ||
    name === "x-rewrite-url" || name.startsWith("x-forwarded-"));
const cookie = (req: IncomingMessage, key: string): string => {
  const raw = req.headers.cookie;
  if (typeof raw !== "string" || raw.length > 1024) return "";
  const found = raw.split(";").map((part) => part.trim()).filter((part) => part.startsWith(key + "="));
  if (found.length !== 1) return "";
  return found[0]!.slice(key.length + 1);
};
const setCookie = (key: string, value: string, age: number): string =>
  key + "=" + value + "; Path=" + cookiePath + "; HttpOnly; Secure; SameSite=Strict; Max-Age=" + age;

// Fixed upstream paths: a grant never becomes a general-purpose HTTP proxy.
async function upstream(config: Credentials, path: "/api/v1/admin/access" | "/api/v1/management" | "/api/v1/status",
  method: "GET" | "POST", body = "", session?: Session): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: "localhost", Authorization: "Bearer " + config.token,
      Accept: "application/json", Connection: "close",
    };
    if (session) {
      headers["X-DC24H-Admin-Grant"] = session.grant;
      headers["X-DC24H-Session"] = session.apiSession;
      headers["X-DC24H-Csrf"] = session.apiCsrf;
    }
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    // The socket's idle timeout alone is not a total deadline: a peer that
    // trickles bytes could otherwise hold a private-API request indefinitely.
    const call = request({ socketPath: config.socket, path, method, agent: false, headers,
      signal: AbortSignal.timeout(4000) }, (answer) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      const scrub = () => { for (const chunk of chunks) chunk.fill(0); chunks.length = 0; };
      // 'end' is not emitted on truncated, aborted or oversized responses.
      answer.on("close", scrub);
      answer.on("data", (part: Buffer) => {
        bytes += part.length;
        if (bytes > 65536) { call.destroy(new Error("upstream_size")); return; }
        chunks.push(part);
      });
      answer.on("end", () => {
        let assembled: Buffer | undefined;
        try {
          // Preserve the HTTP denial status even if an upstream proxy returns
          // plain text or invalid JSON. The caller must revoke the session.
          if (answer.statusCode !== 200) {
            const error = new Error("upstream_status");
            (error as Error & { status: number }).status = answer.statusCode ?? 503;
            reject(error);
            return;
          }
          if (!isJsonContentType(answer.headers["content-type"])) throw Error();
          assembled = Buffer.concat(chunks);
          const value: unknown = JSON.parse(assembled.toString("utf8"));
          resolve(value);
        } catch { reject(new Error("upstream_invalid")); }
        finally { assembled?.fill(0); scrub(); }
      });
    });
    call.setTimeout(4000, () => call.destroy(new Error("upstream_timeout")));
    call.on("error", reject);
    call.end(body);
  });
}

export function remoteGateway(config: Credentials | null, options: RemoteOptions) {
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::[1-9]\d{1,4})?$/.test(options.origin)) throw new Error("HTTPS origin required");
  const clock = options.now ?? Date.now;
  const audit = options.audit ?? (() => {});
  const callUpstream = options.upstream ?? upstream;
  const sessions = new Map<string, Session>();
  const challenges = new Map<string, Challenge>();
  const passkeyLogins = new Map<string, PasskeyPending>();
  const enrollments = new Map<string, { challenge: string; expires: number; session: Session }>();
  const budgets = new Map<string, Budget>();

  const log = (event: RemoteEvent): boolean => {
    // Audit integrations are external observers; a failed sink must not crash
    // the HTTP handler or change the decision to reject a request.
    try {
      const written: unknown = audit(event);
      if (written && typeof written === "object" && "then" in written &&
          typeof written.then === "function") {
        void Promise.resolve(written).catch(() => {});
        return !options.strictAudit;
      }
      return true;
    } catch { return false; }
  };
  const prune = (now: number) => {
    for (const [id, value] of sessions) {
      if (value.created + absoluteTime <= now || value.used + idleTime <= now) sessions.delete(id);
    }
    for (const [id, value] of challenges) if (value.expires <= now) challenges.delete(id);
    for (const [id, value] of passkeyLogins) if (value.expires <= now) passkeyLogins.delete(id);
    for (const [id, value] of enrollments) if (value.expires <= now) enrollments.delete(id);
    for (const [id, value] of budgets) if (value.starts + 60_000 <= now) budgets.delete(id);
  };
  const limited = (key: string, limit: number, now: number) => {
    const entry = budgets.get(key);
    if (!entry || entry.starts + 60_000 <= now) { budgets.set(key, { count: 1, starts: now }); return false; }
    entry.count++;
    return entry.count > limit;
  };
  const expired = (session: Session, at: number): boolean =>
    session.created + absoluteTime <= at || session.used + idleTime <= at;
  const reply = (res: ServerResponse, status: number, data: unknown, cookies: string[] = []) => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Pragma": "no-cache", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
      ...(status === 429 ? { "Retry-After": "60" } : {}),
      ...(cookies.length ? { "Set-Cookie": cookies } : {}),
    });
    res.end(JSON.stringify(data));
  };
  const clearSession = () => [setCookie("dc24h_remote", "", 0)];
  const active = (req: IncomingMessage, now: number): [string, Session] | null => {
    const id = cookie(req, "dc24h_remote");
    if (!/^[0-9a-f]{64}$/.test(id)) return null;
    const session = sessions.get(id);
    if (!session || session.mfaVerified !== true || expired(session, now)) {
      sessions.delete(id);
      return null;
    }
    try {
      if (options.passkeys && session.passkeyEpoch !== options.passkeys.store.epoch(session.actor)) {
        sessions.delete(id); return null;
      }
    } catch { sessions.delete(id); return null; }
    return [id, session];
  };
  const authorized = async (id: string, value: Session, existing = false): Promise<"ok" | "revoked" | "unavailable"> => {
    if (!config) return "unavailable";
    try {
      if (options.passkeys && value.passkeyEpoch !== options.passkeys.store.epoch(value.actor)) {
        if (existing) sessions.delete(id);
        return "revoked";
      }
      const catalog = parseManagement(await callUpstream(config, "/api/v1/management", "GET", "", value));
      if (catalog.areas[0].allowed && catalog.areas[1].allowed) {
        // A concurrent request may have revoked this session while the API
        // request was in flight. Never restore authority from a late success.
        if (existing && sessions.get(id) !== value) return "revoked";
        if (options.passkeys && value.passkeyEpoch !== options.passkeys.store.epoch(value.actor)) return "revoked";
        return "ok";
      }
      sessions.delete(id);
      log("session_revoked");
      return "revoked";
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404) {
        sessions.delete(id);
        log("session_revoked");
        return "revoked";
      }
      log("api_unavailable");
      return "unavailable";
    }
  };
  const readBody = async (req: IncomingMessage, limit = maxBody): Promise<unknown> => {
    const length = req.headers["content-length"];
    if (req.headers["transfer-encoding"] || !/^[1-9]\d{0,4}$/.test(String(length)) ||
        Number(length) > limit || req.headers["content-type"] !== "application/json") throw new Error("bad_body");
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const part of req) {
        const chunk = part as Buffer;
        chunks.push(chunk);
        size += chunk.length;
        if (size > limit) throw new Error("bad_body");
      }
      if (size !== Number(length)) throw new Error("bad_body");
      const assembled = Buffer.concat(chunks);
      try { return JSON.parse(assembled.toString("utf8")) as unknown; }
      finally { assembled.fill(0); }
    } finally { for (const chunk of chunks) chunk.fill(0); }
  };
  const provePassword = async (actor: string, proof: string): Promise<Session> => {
    if (!config) throw Object.assign(new Error("unavailable"), { status: 503 });
    const form = "actor_id=" + encodeURIComponent(actor) + "&proof=" + encodeURIComponent(proof);
    const issued = parseAccess(await callUpstream(config, "/api/v1/admin/access", "POST", form));
    if (issued.actor.id !== actor || !["administrator", "owner"].includes(issued.actor.role))
      throw Error("identity_refused");
    const session: Session = {
      mfaVerified: true, actor, grant: issued.grant, apiSession: issued.session, apiCsrf: issued.csrf,
      csrf: randomBytes(32).toString("hex"), created: 0, used: 0, pendingLogouts: 0,
      passkeyEpoch: options.passkeys?.store.epoch(actor) ?? 0,
    };
    const check = await authorized("pending", session);
    if (check !== "ok") throw Object.assign(new Error("authorization_refused"),
      check === "unavailable" ? { status: 503 } : {});
    return session;
  };
  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "";
    const method = req.method ?? "";
    const now = clock();
    prune(now);
    const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    const post = name === "login" || name === "logout" || passkeyPost.has(name);
    const valid = safePath.has(name) && (post ? method === "POST" : method === "GET");
    // No query strings, normalized paths, wildcard methods or forwarding.
    if (!valid) { log("route_refused"); reply(res, 404, { error: "not_found" }); return; }
    const host = req.headers.host ?? "";
    if (!loopback(req.socket.remoteAddress) ||
      !/^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== options.origin) ||
      (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"]))) ||
      req.headers["x-dc24h-admin-grant"] || req.headers["x-dc24h-session"] ||
      req.headers["x-dc24h-csrf"] || untrustedProxyHeader(req) ||
      (post && req.headers.origin !== options.origin)) {
      log("route_refused"); reply(res, 403, { error: "forbidden" }); return;
    }
    if (!post && (req.headers["transfer-encoding"] ||
      (req.headers["content-length"] && req.headers["content-length"] !== "0"))) {
      reply(res, 400, { error: "bad_request" }); return;
    }
    let auditAvailable = !options.strictAudit;
    if (options.strictAudit) {
      try { auditAvailable = options.auditHealthy?.() === true; }
      catch { auditAvailable = false; }
    }
    if (!auditAvailable) {
      sessions.clear(); challenges.clear(); passkeyLogins.clear(); enrollments.clear();
      reply(res, 503, { error: "unavailable" }, clearSession()); return;
    }
    if (name === "challenge") {
      if (limited("challenge", 20, now) || challenges.size >= 128) {
        reply(res, 429, { error: "rate_limited" }); return;
      }
      const id = randomBytes(32).toString("hex");
      const token = randomBytes(32).toString("hex");
      challenges.set(id, { token, expires: now + challengeTime });
      reply(res, 200, { schema: 1, csrf: token }, [setCookie("dc24h_remote_init", id, 120)]);
      return;
    }
    if (name === "login") {
      // A challenge is one-use even if request framing or JSON is invalid.
      const previousSession = cookie(req, "dc24h_remote");
      const prior = /^[0-9a-f]{64}$/.test(previousSession)
        ? sessions.get(previousSession) : undefined;
      const init = cookie(req, "dc24h_remote_init");
      const challenge = challenges.get(init);
      challenges.delete(init);
      let fields: Record<string, unknown>;
      try { fields = object(await readBody(req)); }
      catch { reply(res, 400, { error: "bad_request" }, [setCookie("dc24h_remote_init", "", 0)]); return; }
      const actor = fields.actor_id;
      const proof = fields.password;
      const otp = fields.otp;
      const csrf = req.headers["x-dc24h-remote-csrf"];
      if (typeof actor !== "string" || !/^[1-9]\d{0,18}$/.test(actor) ||
        BigInt(actor) > 9223372036854775807n ||
        typeof proof !== "string" || !proof.length || proof.length > 1024 ||
        typeof otp !== "string" || !/^\d{6}$/.test(otp) || Object.keys(fields).length !== 3 ||
        typeof csrf !== "string" || !challenge || challenge.expires <= clock() ||
        !sameSecret(challenge.token, csrf)) {
        log("login_refused"); reply(res, 403, { error: "login_refused" }, [setCookie("dc24h_remote_init", "", 0)]); return;
      }
      if (limited("login:global", 12, now) || limited("login:" + actor, 4, now)) {
        log("login_refused"); reply(res, 429, { error: "rate_limited" }); return;
      }
      if (!config) { reply(res, 503, { error: "unavailable" }); return; }
      try {
        const session = await provePassword(actor, proof);
        const key = randomBytes(32).toString("hex");
        if (!options.mfaVerify) {
          const fault = new Error("mfa_not_configured") as Error & { status: number };
          fault.status = 503;
          throw fault;
        }
        let verified = false;
        try { verified = options.mfaVerify(actor, otp, clock()); }
        catch {
          const fault = new Error("mfa_unavailable") as Error & { status: number };
          fault.status = 503;
          throw fault;
        }
        if (!verified) { log("mfa_refused"); throw new Error("mfa_refused"); }
        // A concurrent logout or earlier re-login may have removed this
        // browser session while credentials were being verified. Do not
        // create an orphaned new session from the revoked predecessor.
        if (prior && (sessions.get(previousSession) !== prior || prior.pendingLogouts > 0)) {
          throw new Error("prior_session_revoked");
        }
        // Begin the session only after the asynchronous proof and permission
        // recheck succeed. A slow upstream must not issue an expired cookie.
        session.created = clock();
        session.used = session.created;
        // Re-authentication replaces the session presented by this browser;
        // a previously issued cookie must never remain usable in parallel.
        if (prior) sessions.delete(previousSession);
        if (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value!);
        sessions.set(key, session);
        const mfaLogged = log("mfa_ok"), loginLogged = log("login_ok");
        if (options.strictAudit && (!mfaLogged || !loginLogged)) {
          // A successful login must never be issued without its durable
          // authentication records; revoke the just-created session.
          sessions.delete(key);
          reply(res, 503, { error: "unavailable" }, [setCookie("dc24h_remote_init", "", 0)]);
          return;
        }
        reply(res, 200, { schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: session.csrf, expires_in: 600 },
          [setCookie("dc24h_remote", key, 600), setCookie("dc24h_remote_init", "", 0)]);
      } catch (error) {
        log("login_refused");
        const status = (error as { status?: number }).status;
        const outage = typeof status === "number" && status >= 500;
        reply(res, status === 429 ? 429 : outage ? 503 : 403,
          { error: status === 429 ? "rate_limited" : outage ? "unavailable" : "login_refused" },
          [setCookie("dc24h_remote_init", "", 0)]);
      }
      return;
    }
    if (name.startsWith("passkey/")) {
      const p = options.passkeys;
      if (!p || !p.store.healthy()) {
        sessions.clear(); passkeyLogins.clear(); enrollments.clear();
        reply(res, 503, { error: "unavailable" }, clearSession()); return;
      }
      // Challenge-based password proof is mandatory to obtain a C++ grant.
      // Passkeys replace TOTP here, not the C++ password authorization boundary.
      if (name === "passkey/login/options") {
        const init = cookie(req, "dc24h_remote_init");
        const initial = challenges.get(init);
        challenges.delete(init);
        let fields: Record<string, unknown>;
        try { fields = object(await readBody(req)); }
        catch { reply(res, 400, { error: "bad_request" }); return; }
        const actor = fields.actor_id, proof = fields.password;
        const csrf = req.headers["x-dc24h-remote-csrf"];
        if (typeof actor !== "string" || !/^[1-9]\d{0,18}$/.test(actor) ||
            BigInt(actor) > 9223372036854775807n || typeof proof !== "string" ||
            !proof || proof.length > 1024 || Object.keys(fields).length !== 2 ||
            typeof csrf !== "string" || !initial || initial.expires <= clock() ||
            !sameSecret(initial.token, csrf)) {
          log("passkey_login_refused"); reply(res, 403, { error: "login_refused" }); return;
        }
        if (limited("login:global", 12, now) || limited("login:" + actor, 4, now) || passkeyLogins.size >= 64) {
          reply(res, 429, { error: "rate_limited" }); return;
        }
        try {
          const previousKey = cookie(req, "dc24h_remote");
          const prior = sessions.get(previousKey);
          const session = await provePassword(actor, proof);
          const opts = await p.ceremonies.beginLogin(actor);
          if (!opts) { log("passkey_login_refused"); reply(res, 403, { error: "login_refused" }); return; }
          const token = randomBytes(32).toString("hex");
          passkeyLogins.set(token, { actor, session, challenge: opts.challenge, csrf: initial.token,
            expires: clock() + 60_000, oldKey: previousKey, oldSession: prior });
          reply(res, 200, opts, [setCookie("dc24h_remote_passkey", token, 60), setCookie("dc24h_remote_init", "", 0)]);
        } catch {
          log("passkey_login_refused"); reply(res, 403, { error: "login_refused" });
        }
        return;
      }
      if (name === "passkey/login/finish") {
        const token = cookie(req, "dc24h_remote_passkey");
        const pending = passkeyLogins.get(token);
        passkeyLogins.delete(token); // consume before parsing/awaiting verification
        const clear = [setCookie("dc24h_remote_passkey", "", 0)];
        const csrf = req.headers["x-dc24h-remote-csrf"];
        if (!pending || pending.expires <= clock() || typeof csrf !== "string" || !sameSecret(pending.csrf, csrf)) {
          log("passkey_login_refused"); reply(res, 403, { error: "login_refused" }, clear); return;
        }
        try {
          const fields = object(await readBody(req, maxCeremonyBody));
          if (Object.keys(fields).length !== 1 || !fields.response || typeof fields.response !== "object") throw Error();
          const verified = await p.ceremonies.finishLogin(pending.actor, pending.challenge,
            fields.response as Parameters<PasskeyCeremonies["finishLogin"]>[2], clock());
          if (!verified || (pending.oldSession &&
              (sessions.get(pending.oldKey) !== pending.oldSession || pending.oldSession.pendingLogouts > 0))) throw Error();
          const key = randomBytes(32).toString("hex");
          if (await authorized(key, pending.session) !== "ok" ||
              pending.session.passkeyEpoch !== p.store.epoch(pending.actor)) throw Error();
          pending.session.created = clock(); pending.session.used = pending.session.created;
          if (pending.oldSession) sessions.delete(pending.oldKey);
          if (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value!);
          sessions.set(key, pending.session);
          if (!log("passkey_login_ok") || !log("login_ok")) {
            if (options.strictAudit) throw Error("audit_unavailable");
          }
          reply(res, 200, { schema: 1, authenticated: true, mfa: true, mode: "read-only",
            csrf: pending.session.csrf, expires_in: 600 },
            [setCookie("dc24h_remote", key, 600), ...clear]);
        } catch {
          // If a post-verification audit failed, revoke the newly-created
          // slot rather than leave a live cookie with unlogged authority.
          for (const [id, s] of sessions) if (s === pending.session) sessions.delete(id);
          log("passkey_login_refused"); reply(res, 403, { error: "login_refused" }, clear);
        }
        return;
      }
      const entry = active(req, clock());
      if (!entry) { reply(res, 401, { error: "unauthorized" }, clearSession()); return; }
      const [key, session] = entry;
      const checked = await authorized(key, session, true);
      if (checked !== "ok" || sessions.get(key) !== session || expired(session, clock())) {
        reply(res, checked === "unavailable" ? 503 : 403, { error: checked === "unavailable" ? "unavailable" : "forbidden" }); return;
      }
      if (name === "passkey/devices") {
        reply(res, 200, { schema: 1, devices: p.store.forActor(session.actor).map(c => ({
          id: c.id, name: c.name, device_type: c.deviceType, backed_up: c.backedUp,
          created_at: c.createdAt, last_used_at: c.lastUsedAt,
        })) }); return;
      }
      const csrf = req.headers["x-dc24h-remote-csrf"];
      if (typeof csrf !== "string" || !sameSecret(session.csrf, csrf)) {
        reply(res, 403, { error: "csrf_required" }); return;
      }
      // Every credential mutation requires a freshly authenticated browser
      // session. No password-only bypass and no cross-account device ID.
      if (clock() - session.created > 60_000) {
        reply(res, 403, { error: "fresh_login_required" }); return;
      }
      if (name === "passkey/enroll/options") {
        try {
          const fields = object(await readBody(req));
          if (Object.keys(fields).length || enrollments.size >= 64 ||
              limited("passkey:enroll:" + session.actor, 5, now)) throw Error();
          const opts = await p.ceremonies.beginEnrollment(session.actor);
          enrollments.set(key, { challenge: opts.challenge, expires: clock() + 60_000, session });
          reply(res, 200, opts);
        } catch { log("passkey_enroll_refused"); reply(res, 403, { error: "enrollment_refused" }); }
        return;
      }
      if (name === "passkey/enroll/finish") {
        const pending = enrollments.get(key);
        enrollments.delete(key); // one use, including invalid payloads
        try {
          if (!pending || pending.session !== session || pending.expires <= clock()) throw Error();
          const fields = object(await readBody(req, maxCeremonyBody));
          if (Object.keys(fields).length !== 1 || !fields.response || typeof fields.response !== "object") throw Error();
          if (options.strictAudit && !log("passkey_enroll_intent")) throw Error("audit_unavailable");
          const result = await p.ceremonies.finishEnrollment(session.actor, pending.challenge,
            fields.response as Parameters<PasskeyCeremonies["finishEnrollment"]>[2], clock(),
            async () => sessions.get(key) === session && !expired(session, clock()) &&
              await authorized(key, session, true) === "ok");
          if (!result || sessions.get(key) !== session || expired(session, clock())) throw Error();
          if (!log("passkey_enrolled") && options.strictAudit) throw Error("audit_unavailable");
          reply(res, 200, { schema: 1, enrolled: true });
        } catch { log("passkey_enroll_refused"); reply(res, 403, { error: "enrollment_refused" }); }
        return;
      }
      if (name === "passkey/device/rename" || name === "passkey/device/revoke") {
        try {
          const fields = object(await readBody(req));
          if (limited("passkey:device:" + session.actor, 10, now)) throw Error();
          if (typeof fields.id !== "string" ||
              Object.keys(fields).length !== (name.endsWith("rename") ? 2 : 1)) throw Error();
          if (name.endsWith("rename")) {
            if (typeof fields.name !== "string" || !p.store.rename(session.actor, fields.id, fields.name)) throw Error();
            if (!log("passkey_device_renamed") && options.strictAudit) throw Error();
            reply(res, 200, { schema: 1, renamed: true });
          } else {
            if (!p.store.get(session.actor, fields.id) || (options.strictAudit && !log("passkey_revoke_intent"))) throw Error();
            if (!p.store.revoke(session.actor, fields.id, clock())) throw Error();
            for (const [id, s] of sessions) if (s.actor === session.actor) sessions.delete(id);
            if (!log("passkey_revoked") && options.strictAudit) throw Error();
            reply(res, 200, { schema: 1, revoked: true }, clearSession());
          }
        } catch { reply(res, 403, { error: "device_refused" }); }
        return;
      }
    }
    const entry = active(req, now);
    if (!entry) { reply(res, 401, { error: "unauthorized" }, clearSession()); return; }
    const [key, session] = entry;
    if (name === "logout") {
      if (typeof req.headers["x-dc24h-remote-csrf"] !== "string" ||
          !sameSecret(session.csrf, req.headers["x-dc24h-remote-csrf"])) {
        reply(res, 403, { error: "csrf_required" }); return;
      }
      // A concurrent re-login must not survive a logout whose valid CSRF
      // was checked before its request body finished arriving. Track every
      // pending logout so an invalid parallel body cannot clear the guard.
      session.pendingLogouts++;
      try { await readBody(req); }
      catch { reply(res, 400, { error: "bad_request" }); return; }
      finally { session.pendingLogouts--; }
      if (sessions.get(key) !== session) {
        reply(res, 401, { error: "unauthorized" }, clearSession());
        return;
      }
      sessions.delete(key);
      log("logout");
      reply(res, 200, { schema: 1, authenticated: false }, clearSession());
      return;
    }
    const check = await authorized(key, session, true);
    if (check === "revoked") { reply(res, 403, { error: "forbidden" }, clearSession()); return; }
    if (check !== "ok") { reply(res, 503, { error: "unavailable" }); return; }
    // An upstream read may complete after the original request's session
    // deadline. Recheck the clock after awaiting authorization.
    const checkedAt = clock();
    if (sessions.get(key) !== session) {
      reply(res, 403, { error: "forbidden" }, clearSession());
      return;
    }
    if (expired(session, checkedAt)) {
      sessions.delete(key);
      reply(res, 401, { error: "unauthorized" }, clearSession());
      return;
    }
    session.used = checkedAt;
    if (name === "session") {
      reply(res, 200, {
        schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: session.csrf,
        expires_in: Math.max(0, Math.floor(Math.min(session.created + absoluteTime - checkedAt, idleTime) / 1000)),
      });
      return;
    }
    try {
      if (!config) throw new Error("unavailable");
      const data = parseRemoteSummary(await callUpstream(config, "/api/v1/status", "GET"));
      if (sessions.get(key) !== session) {
        reply(res, 403, { error: "forbidden" }, clearSession());
        return;
      }
      if (expired(session, clock())) {
        sessions.delete(key);
        reply(res, 401, { error: "unauthorized" }, clearSession());
        return;
      }
      // Permission can be revoked while the status request is in flight.
      // A check performed only before reading status permits a stale request
      // to expose metrics even after the upstream has withdrawn access.
      const finalCheck = await authorized(key, session, true);
      if (finalCheck === "revoked") {
        reply(res, 403, { error: "forbidden" }, clearSession());
        return;
      }
      if (finalCheck !== "ok") {
        reply(res, 503, { error: "unavailable" });
        return;
      }
      if (sessions.get(key) !== session) {
        reply(res, 403, { error: "forbidden" }, clearSession());
        return;
      }
      if (expired(session, clock())) {
        sessions.delete(key);
        reply(res, 401, { error: "unauthorized" }, clearSession());
        return;
      }
      // The dedicated parser has already validated and constructed only the
      // reviewed aggregate fields; never serialize a raw private API object.
      reply(res, 200, { schema: 1, mode: "read-only", ...data });
    } catch {
      log("api_unavailable"); reply(res, 503, { error: "unavailable" });
    }
  };
}

// Private, local-only WebAuthn credential catalog. Browser APIs receive only
// credential IDs when needed, never the raw public keys or storage paths.
// This intentionally does not give the Node gateway SQL credentials or add a
// second authority capable of minting password-free C++ admin grants.
import { randomBytes } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, renameSync, unlinkSync, writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { WebAuthnCredential } from "@simplewebauthn/server";

export type PasskeyEntry = {
  id: string;
  actor: string;
  userHandle: string;
  publicKey: string;
  counter: number;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};
type User = { actor: string; handle: string; epoch: number };
type Document = { schema: 1; rpID: string; users: User[]; credentials: PasskeyEntry[] };
const idPattern = /^[A-Za-z0-9_-]{20,1400}$/;
const actorPattern = /^[1-9]\d{0,18}$/;
const maxBytes = 1024 * 1024;
const transports = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);
const safeTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const safeActor = (v: unknown): v is string => typeof v === "string" && actorPattern.test(v) && BigInt(v) <= 9223372036854775807n;

function validDocument(v: unknown, rpID: string): v is Document {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const doc = v as Partial<Document>;
  if (doc.schema !== 1 || doc.rpID !== rpID || !Array.isArray(doc.users) ||
      !Array.isArray(doc.credentials) || doc.users.length > 64 || doc.credentials.length > 256) return false;
  const actors = new Set<string>(), handles = new Set<string>(), ids = new Set<string>();
  for (const user of doc.users) {
    if (!user || !safeActor(user.actor) || typeof user.handle !== "string" ||
        !idPattern.test(user.handle) || !safeTime(user.epoch) ||
        actors.has(user.actor) || handles.has(user.handle)) return false;
    actors.add(user.actor); handles.add(user.handle);
  }
  for (const c of doc.credentials) {
    if (!c || typeof c !== "object" || !safeActor(c.actor) || !actors.has(c.actor) ||
        typeof c.id !== "string" || !idPattern.test(c.id) || ids.has(c.id) ||
        typeof c.userHandle !== "string" || c.userHandle !== doc.users.find(u => u.actor === c.actor)?.handle ||
        typeof c.publicKey !== "string" || !idPattern.test(c.publicKey) ||
        !safeTime(c.counter) || !["singleDevice", "multiDevice"].includes(c.deviceType) ||
        typeof c.backedUp !== "boolean" || (c.deviceType === "singleDevice" && c.backedUp) ||
        !Array.isArray(c.transports) || c.transports.length > 7 ||
        !c.transports.every(t => typeof t === "string" && transports.has(t)) ||
        typeof c.name !== "string" || c.name.length > 64 || !/^[^\u0000-\u001f\u007f<>]*$/.test(c.name) ||
        !safeTime(c.createdAt) || (c.lastUsedAt !== null && !safeTime(c.lastUsedAt)) ||
        (c.revokedAt !== null && !safeTime(c.revokedAt))) return false;
    ids.add(c.id);
  }
  return true;
}

function privateParent(path: string): void {
  if (!isAbsolute(path)) throw Error("Absolute private passkey path required");
  const dir = lstatSync(dirname(path));
  if (!dir.isDirectory() || dir.uid !== process.geteuid?.() || (dir.mode & 0o077))
    throw Error("Unsafe passkey directory");
}
function safeStat(path: string) {
  const s = lstatSync(path);
  if (!s.isFile() || s.uid !== process.geteuid?.() || s.nlink !== 1 || (s.mode & 0o077) ||
      s.size < 2 || s.size > maxBytes) throw Error("Unsafe passkey catalog");
  return s;
}
function persist(path: string, doc: Document): void {
  const bytes = Buffer.from(JSON.stringify(doc) + "\n", "utf8");
  if (bytes.length > maxBytes) throw Error("Passkey catalog full");
  const tmp = join(dirname(path), "." + basename(path) + "." + randomBytes(12).toString("hex"));
  let fd: number | undefined;
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    if (writeSync(fd, bytes) !== bytes.length) throw Error("Incomplete passkey write");
    fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(tmp, path);
    const dir = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } catch (e) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tmp); } catch { /* Rename may have completed. */ }
    throw e;
  } finally { bytes.fill(0); }
}

export function openPasskeyStore(path: string, rpID: string) {
  if (!/^(?:localhost|[a-z0-9]+(?:[.-][a-z0-9]+)*)$/.test(rpID) || rpID.length > 253)
    throw Error("Invalid passkey RP ID");
  privateParent(path);
  let doc: Document;
  try {
    const before = safeStat(path);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      if (opened.dev !== before.dev || opened.ino !== before.ino) throw Error("Passkey file changed");
      const bytes = readFileSync(fd);
      try {
        if (bytes.length !== opened.size) throw Error("Passkey file changed");
        doc = JSON.parse(bytes.toString("utf8")) as Document;
      } finally { bytes.fill(0); }
    } finally { closeSync(fd); }
    if (!validDocument(doc!, rpID)) throw Error("Invalid passkey catalog");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    doc = { schema: 1, rpID, users: [], credentials: [] };
    // Exclusive initial creation; if another process won, fail and restart.
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const bytes = Buffer.from(JSON.stringify(doc) + "\n");
      try { if (writeSync(fd, bytes) !== bytes.length) throw Error("Incomplete passkey init"); fsyncSync(fd); }
      finally { bytes.fill(0); }
    } finally { closeSync(fd); }
    const dir = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  let identity = safeStat(path);
  let healthy = true;
  const check = () => {
    if (!healthy) throw Error("Passkey catalog unavailable");
    try {
      privateParent(path);
      const s = safeStat(path);
      if (s.dev !== identity.dev || s.ino !== identity.ino || s.size !== identity.size ||
          s.mtimeMs !== identity.mtimeMs) throw Error("Passkey catalog changed outside gateway");
    } catch (e) { healthy = false; throw e; }
  };
  const write = (next: Document) => {
    check();
    if (!validDocument(next, rpID)) throw Error("Invalid passkey state");
    try { persist(path, next); identity = safeStat(path); doc = next; }
    catch (e) { healthy = false; throw e; }
  };
  const forActor = (actor: string) => {
    check();
    return doc.credentials.filter(c => c.actor === actor && c.revokedAt === null).map(c => ({ ...c, transports: [...c.transports] }));
  };
  const get = (actor: string, id: string) => forActor(actor).find(c => c.id === id);
  const epoch = (actor: string) => { check(); return doc.users.find(u => u.actor === actor)?.epoch ?? 0; };
  const userHandle = (actor: string) => {
    if (!safeActor(actor)) throw Error("Invalid actor");
    check();
    const known = doc.users.find(u => u.actor === actor);
    if (known) return known.handle;
    if (doc.users.length >= 64) throw Error("Passkey user catalog full");
    const handle = randomBytes(32).toString("base64url");
    write({ ...doc, users: [...doc.users, { actor, handle, epoch: 0 }] });
    return handle;
  };
  const add = (entry: PasskeyEntry) => {
    check();
    if (doc.credentials.length >= 256 || forActor(entry.actor).length >= 8 ||
        doc.credentials.some(c => c.id === entry.id)) throw Error("Passkey capacity or duplicate ID");
    write({ ...doc, credentials: [...doc.credentials, entry] });
  };
  const markUsed = (actor: string, id: string, prior: number, next: number, type: PasskeyEntry["deviceType"], backup: boolean, now: number) => {
    const entry = get(actor, id);
    if (!entry || entry.counter !== prior || !safeTime(next) || !safeTime(now) ||
        (entry.counter !== 0 && next <= entry.counter) || (type === "singleDevice" && backup) ||
        (entry.deviceType === "singleDevice" && type !== "singleDevice")) return false;
    write({ ...doc, credentials: doc.credentials.map(c => c.id === id ?
      { ...c, counter: next, deviceType: type, backedUp: backup, lastUsedAt: now } : c) });
    return true;
  };
  const rename = (actor: string, id: string, name: string) => {
    const existing = get(actor, id);
    const trimmed = name.trim();
    if (!existing || !trimmed || trimmed.length > 64 || /[\u0000-\u001f\u007f<>]/.test(trimmed)) return false;
    write({ ...doc, credentials: doc.credentials.map(c => c.id === id ? { ...c, name: trimmed } : c) });
    return true;
  };
  const revoke = (actor: string, id: string, now: number) => {
    if (!get(actor, id) || !safeTime(now)) return false;
    write({ ...doc,
      users: doc.users.map(u => u.actor === actor ? { ...u, epoch: u.epoch + 1 } : u),
      credentials: doc.credentials.map(c => c.id === id ? { ...c, revokedAt: now } : c),
    });
    return true;
  };
  const revokeAll = (actor: string, now: number) => {
    check();
    if (!safeActor(actor) || !safeTime(now)) throw Error("Invalid recovery request");
    const count = forActor(actor).length;
    if (!count) return 0;
    write({ ...doc,
      users: doc.users.map(u => u.actor === actor ? { ...u, epoch: u.epoch + 1 } : u),
      credentials: doc.credentials.map(c => c.actor === actor && c.revokedAt === null ? { ...c, revokedAt: now } : c),
    });
    return count;
  };
  return { check, forActor, get, epoch, userHandle, add, markUsed, rename, revoke, revokeAll,
    healthy: () => { try { check(); return true; } catch { return false; } } };
}
export type PasskeyStore = ReturnType<typeof openPasskeyStore>;
export const credentialForVerification = (entry: PasskeyEntry): WebAuthnCredential => ({
  id: entry.id, publicKey: new Uint8Array(Buffer.from(entry.publicKey, "base64url")),
  counter: entry.counter, transports: entry.transports,
});

// Offline-only controlled revocation; this tool has no HTTP endpoint.
// The two operator names are acknowledgments, not cryptographic approvals.
// The operator must verify identity and authorization independently.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { openPasskeyStore } from "./remote-passkeys.ts";
import { openRemoteAuditStore } from "./remote-audit-store.ts";

function request(path: string): { actor: string; approvers: [string, string] } {
  if (!isAbsolute(path)) throw Error("Absolute private recovery request required");
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.uid !== process.geteuid?.() || (parent.mode & 0o077))
    throw Error("Unsafe recovery request directory");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.uid !== process.geteuid?.() || s.nlink !== 1 || (s.mode & 0o077) ||
        s.size < 2 || s.size > 2048) throw Error("Unsafe recovery request");
    const bytes = readFileSync(fd);
    let obj: unknown;
    try { obj = JSON.parse(bytes.toString("utf8")) as unknown; }
    finally { bytes.fill(0); }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw Error("Unsafe recovery request");
    const v = obj as Record<string, unknown>;
    if (Object.keys(v).sort().join(",") !== "actor,approvers,schema" || v.schema !== 1 ||
        typeof v.actor !== "string" || !/^[1-9]\d{0,18}$/.test(v.actor) ||
        BigInt(v.actor) > 9223372036854775807n || !Array.isArray(v.approvers) || v.approvers.length !== 2 ||
        !v.approvers.every(x => typeof x === "string" && /^[A-Za-z0-9._-]{3,64}$/.test(x)) ||
        v.approvers[0] === v.approvers[1]) throw Error("Unsafe recovery request");
    return { actor: v.actor, approvers: v.approvers as [string, string] };
  } finally { closeSync(fd); }
}

function main(args: string[]) {
  if (args.length !== 9 || args[0] !== "--catalog" || args[2] !== "--rp-id" ||
      args[4] !== "--audit" || args[6] !== "--request" || args[8] !== "--offline-ack")
    throw Error("Usage: --catalog ABSOLUTE_PATH --rp-id FIXED_HOST --audit AUDIT_PATH --request PRIVATE_JSON --offline-ack");
  const record = request(args[7]!);
  const store = openPasskeyStore(args[1]!, args[3]!);
  const audit = openRemoteAuditStore(args[5]!);
  try {
    audit.append("passkey_recovery_intent", Date.now());
    const count = store.revokeAll(record.actor, Date.now());
    audit.append("passkey_recovered", Date.now());
    process.stdout.write(`Offline credential recovery: ${count} keys revoked. Restart the local gateway.\n`);
  } finally { audit.close(); }
}

if (process.argv[1]?.endsWith("remote-passkey-recovery.ts")) {
  try { main(process.argv.slice(2)); }
  catch { process.stderr.write("Private offline passkey recovery refused; no browser override.\n"); process.exitCode = 1; }
}
export { request as parseRecoveryRequest };

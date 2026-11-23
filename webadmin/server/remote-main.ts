import { createServer } from "node:http";
import { credentials } from "./local-api.ts";
import { remoteGateway } from "./remote-gateway.ts";
import { loadTotpVerifier } from "./remote-mfa.ts";
import { remoteAuditRecord } from "./remote-audit.ts";
import { openRemoteAuditStore } from "./remote-audit-store.ts";
import { openPasskeyStore } from "./remote-passkeys.ts";
import { passkeyCeremonies, relyingParty } from "./remote-webauthn.ts";

// Explicitly local-only. A public listener or MFA-free deployment is not
// supported by this development release.
if (process.env.DC24H_REMOTE_PUBLIC || process.env.DC24H_REMOTE_BIND) {
  throw new Error("Public remote gateway is disabled");
}
const origin = process.env.DC24H_REMOTE_ORIGIN;
if (!origin) throw new Error("DC24H_REMOTE_ORIGIN is required");
const port = Number(process.env.DC24H_REMOTE_PORT ?? "4182");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local gateway port");
const config = credentials(process.env);
if (!config) throw new Error("Local C++ API credentials required");
const mfaFile = process.env.DC24H_REMOTE_MFA_FILE;
const replayFile = process.env.DC24H_REMOTE_MFA_REPLAY_FILE;
if (!mfaFile || !replayFile) throw new Error("Private TOTP enrollment and replay files required");
const auditFile = process.env.DC24H_REMOTE_AUDIT_FILE;
if (!auditFile) throw new Error("Private durable gateway audit file required");
const passkeyFile = process.env.DC24H_REMOTE_PASSKEY_FILE;
const rpID = process.env.DC24H_REMOTE_RP_ID;
if (!passkeyFile || !rpID) throw new Error("Private passkey file and fixed RP ID required");
relyingParty(origin, rpID);
// Both files are checked for ownership, mode and symlinks before listening.
const mfa = loadTotpVerifier(mfaFile, replayFile);
const auditStore = openRemoteAuditStore(auditFile);
const passkeyStore = openPasskeyStore(passkeyFile, rpID);
const app = createServer(remoteGateway(config, {
  origin,
  passkeys: { store: passkeyStore, ceremonies: passkeyCeremonies(passkeyStore, origin, rpID) },
  mfaVerify: mfa.verify,
  strictAudit: true,
  auditHealthy: () => auditStore.health().healthy,
  // Durable fsync-checked file first. journald mirrors fixed, privacy-limited
  // events only; it never receives credentials, identifiers or raw requests.
  audit: (event) => {
    try { auditStore.append(event, Date.now()); }
    catch {
      process.stderr.write("[remote-gateway] AUDIT_LOSS: sink unavailable; authenticated access refused\n");
      throw new Error("Gateway audit unavailable");
    }
    try { process.stdout.write(remoteAuditRecord(event, Date.now())); }
    catch { /* Journald mirror is secondary to the durable audit store. */ }
  },
}));
app.requestTimeout = 5000;
app.headersTimeout = 6000;
app.maxRequestsPerSocket = 100;
app.listen(port, "127.0.0.1", () => {
  process.stdout.write("[remote-gateway] local-only listener ready\n");
});
process.once("SIGTERM", () => { app.close(); mfa.close(); auditStore.close(); });

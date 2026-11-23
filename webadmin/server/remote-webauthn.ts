import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { PasskeyStore } from "./remote-passkeys.ts";
import { credentialForVerification } from "./remote-passkeys.ts";

// Do not infer the RP ID from Host or X-Forwarded-* headers. The operator must
// choose a fixed secure HTTPS origin; a changed origin needs deliberate
// credential migration/re-enrollment, not automatic acceptance.
export function relyingParty(origin: string, rpID: string) {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.hostname !== rpID ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" ||
      !/^(?:localhost|[a-z0-9]+(?:[.-][a-z0-9]+)*)$/.test(rpID))
    throw Error("Passkey RP ID must equal the configured HTTPS hostname");
  return { origin, rpID };
}

export function passkeyCeremonies(store: PasskeyStore, origin: string, rpID: string) {
  relyingParty(origin, rpID);
  const beginEnrollment = async (actor: string) => {
    const userHandle = store.userHandle(actor);
    const existing = store.forActor(actor);
    if (existing.length >= 8) throw Error("Passkey limit reached");
    const options = await generateRegistrationOptions({
      rpName: "dc24h.eu High Starter", rpID, userName: "administrator-" + actor,
      userDisplayName: "Administrator " + actor,
      userID: new Uint8Array(Buffer.from(userHandle, "base64url")),
      timeout: 60_000, attestationType: "none",
      excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    return options;
  };
  const finishEnrollment = async (actor: string, challenge: string, response: RegistrationResponseJSON, now: number,
    beforePersist: () => Promise<boolean> = async () => true) => {
    const verification = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin,
      expectedRPID: rpID, requireUserPresence: true, requireUserVerification: true,
    });
    if (!verification.verified || !await beforePersist()) return false;
    const info = verification.registrationInfo;
    const handle = store.userHandle(actor);
    store.add({ id: info.credential.id, actor, userHandle: handle,
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      counter: info.credential.counter,
      deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp,
      transports: info.credential.transports?.filter(t => ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(t)) ?? [],
      name: "Passkey", createdAt: now, lastUsedAt: null, revokedAt: null,
    });
    return true;
  };
  const beginLogin = async (actor: string) => {
    const entries = store.forActor(actor);
    if (!entries.length) return null;
    return generateAuthenticationOptions({
      rpID, timeout: 60_000, userVerification: "required",
      allowCredentials: entries.map(c => ({ id: c.id, transports: c.transports })),
    });
  };
  const finishLogin = async (actor: string, challenge: string, response: AuthenticationResponseJSON, now: number) => {
    const entry = store.get(actor, response.id);
    if (!entry) return false;
    if (response.response.userHandle && response.response.userHandle !== entry.userHandle) return false;
    const verified = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
      credential: credentialForVerification(entry), requireUserVerification: true,
    });
    if (!verified.verified || verified.authenticationInfo.credentialID !== entry.id) return false;
    const info = verified.authenticationInfo;
    return store.markUsed(actor, entry.id, entry.counter, info.newCounter,
      info.credentialDeviceType, info.credentialBackedUp, now);
  };
  return { beginEnrollment, finishEnrollment, beginLogin, finishLogin };
}
export type PasskeyCeremonies = ReturnType<typeof passkeyCeremonies>;

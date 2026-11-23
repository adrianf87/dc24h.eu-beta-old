import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { openPasskeyStore } from "../server/remote-passkeys.ts";
import { passkeyCeremonies } from "../server/remote-webauthn.ts";

const origin = "https://localhost:8443", rpID = "localhost";
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const client = (type: string, challenge: string, from = origin) =>
  Buffer.from(JSON.stringify({ type, challenge, origin: from, crossOrigin: false }));
const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest();

function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")],
  ]));
  const id = randomBytes(32);
  const rpHash = sha(rpID);
  const counter = (num: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(num); return b; };
  const registration = (challenge: string, from = origin) => {
    const data = Buffer.concat([rpHash, Buffer.from([0x45]), counter(0), Buffer.alloc(16),
      Buffer.from([0, id.length]), id, Buffer.from(cose)]);
    const attestationObject = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, string>>([
      ["fmt", "none"], ["attStmt", new Map<string, string>()], ["authData", data],
    ]));
    return { id: toBase64(id), rawId: toBase64(id), type: "public-key" as const,
      response: { clientDataJSON: toBase64(client("webauthn.create", challenge, from)),
        attestationObject: toBase64(attestationObject), transports: ["internal"] },
      clientExtensionResults: {}, };
  };
  const assertion = (challenge: string, userHandle: string, num = 1, from = origin) => {
    const data = Buffer.concat([rpHash, Buffer.from([0x05]), counter(num)]);
    const json = client("webauthn.get", challenge, from);
    const signature = createSign("SHA256").update(Buffer.concat([data, sha(json)])).sign(privateKey);
    return { id: toBase64(id), rawId: toBase64(id), type: "public-key" as const,
      response: { clientDataJSON: toBase64(json), authenticatorData: toBase64(data),
        signature: toBase64(signature), userHandle }, clientExtensionResults: {} };
  };
  return { registration, assertion };
}

test("genuine ES256 WebAuthn registration and assertion reject wrong Origin, challenge, replay and account", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dc24h-webauthn-")); chmodSync(dir, 0o700);
  try {
    const store = openPasskeyStore(join(dir, "passkeys.json"), rpID);
    const service = passkeyCeremonies(store, origin, rpID);
    const device = authenticator();
    const opts = await service.beginEnrollment("7");
    assert.equal(opts.rp.id, rpID);
    assert.equal(opts.authenticatorSelection?.userVerification, "required");
    await assert.rejects(() => service.finishEnrollment("7", opts.challenge,
      device.registration(opts.challenge, "https://evil.example"), 1000));
    assert.equal(store.forActor("7").length, 0);
    assert.equal(await service.finishEnrollment("7", opts.challenge, device.registration(opts.challenge), 1000), true);
    assert.equal(store.forActor("7").length, 1);
    const login = await service.beginLogin("7");
    assert.ok(login);
    assert.equal(login!.allowCredentials?.[0]?.id, store.forActor("7")[0]!.id);
    const handle = store.userHandle("7");
    await assert.rejects(() => service.finishLogin("7", login!.challenge,
      device.assertion(login!.challenge, handle, 1, "https://evil.example"), 2000));
    assert.equal(await service.finishLogin("7", login!.challenge, device.assertion(login!.challenge, handle), 2000), true);
    await assert.rejects(() => service.finishLogin("7", login!.challenge, device.assertion(login!.challenge, handle), 2001));
    assert.equal(await service.finishLogin("8", login!.challenge, device.assertion(login!.challenge, handle, 2), 2002), false);
    await assert.rejects(() => service.finishLogin("7", "wrong-challenge", device.assertion(login!.challenge, handle, 2), 2002));
    store.revoke("7", store.forActor("7")[0]!.id, 3000);
    assert.equal(await service.finishLogin("7", login!.challenge, device.assertion(login!.challenge, handle, 3), 3001), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

# Beta 0.4.5–0.4.8 — Stage II: local passkeys and device lifecycle

This is development-only work for [Issue #221](https://github.com/adrianf87/dc24h.eu-high-starter/issues/221).
It does **not** deploy anything, enable an Internet listener, authorize remote hub
mutations, or permit merging before required security checks and review.

## Scope and authentication architecture

| Patch | Delivery |
| --- | --- |
| beta-0.4.5 — WebAuthn Foundation | Fixed HTTPS Origin/RP ID, WebAuthn verification library, owner-only durable credential catalog, counter/backup/revocation model, negative cryptographic vectors |
| beta-0.4.6 — Passkey Enrollment | Recently verified administrator/Owner may enroll up to eight origin-bound credentials; one-use 60-second registration challenge, CSRF, UV/UP and live role checks |
| beta-0.4.7 — Passkey Login | Password plus WebAuthn assertion as phishing-resistant second factor; one-use challenge, authenticated server-side session, replay/counter/Origin/RP ID/signature checks |
| beta-0.4.8 — Device & Recovery | Device list, bounded name changes, key revocation with actor-wide session invalidation, manual offline recovery and security-audit events |

**Important limitation:** The C++ maintenance API currently issues a grant
*only after an account password proof*. Passkey sign-in therefore requires
**password + passkey**, with the passkey replacing TOTP as the second factor.
It is not passwordless login. Neither the browser nor Node can issue a C++
grant without the C++ password/role check. TOTP login remains an alternate
local-only route for enrolled administrators. Never describe the beta-0.4.8
flow as passwordless or broadly Internet-safe.

The C++20 Direct Connect hub (ADC/ADCS) and MariaDB application schema v11
are unchanged. The isolated Node gateway uses versioned, local, private
credential storage rather than giving itself MariaDB credentials. That is an
explicit migration decision: **no SQL migration** in Stage II; a future
move to MariaDB requires separate design, migration/rollback rehearsal and
operator approval. No private passkey material is stored server-side—only
credential identifiers, COSE public keys, RP-local user handles, signature
counters, backup flags, timestamps and revocation records.

## Trust boundaries and HTTP contract

- HTTPS terminates only on loopback Apache2, default
  `https://localhost:8443` (or an explicitly reviewed private SSH tunnel).
  The RP ID must equal the configured HTTPS hostname. Both are fixed by
  `DC24H_REMOTE_ORIGIN` and `DC24H_REMOTE_RP_ID`, never request Host or
  untrusted forwarded headers. Do not change RP ID or certificate name
  silently after enrollment.
- The separate Node process listens on `127.0.0.1:4182`. The private C++ API
  continues on its owner-restricted Unix socket with bearer token; nothing
  is forwarded to public `/admin-api` or service-control endpoints.
- Existing GET `/remote/v1/challenge`, `/session`, `/summary` and POST
  `/login`, `/logout` remain. New exact paths are POST
  `/passkey/login/options`, `/passkey/login/finish`,
  `/passkey/enroll/options`, `/passkey/enroll/finish`,
  `/passkey/device/rename`, `/passkey/device/revoke`, and GET
  `/passkey/devices`, all prefixed with `/remote/v1/`.
- Every POST requires exact Origin, same-site Fetch Metadata, strict JSON
  framing, CSRF and allowlisted method/path. WebAuthn responses have a
  separate 32 KiB cap; ordinary POSTs retain 2 KiB. Cookies are
  Secure/HttpOnly/SameSite=Strict, scoped to `/remote/v1`.
- Challenge options are only returned after C++ password/permission proof
  (login) or an already authenticated, recently verified session (enrollment).
  Both ceremonies consume their one-use server challenge before verification.
  WebAuthn verification uses `@simplewebauthn/server` and enforces exact
  challenge, Origin, RP ID, type, UP, UV, ownership, public-key signature and
  signature-counter/backup behavior.
- Revalidate current C++ account/grants before protected reads and credential
  changes. A key revocation increments the actor's stored session epoch,
  invalidating this actor's browser sessions, including any stale in-flight
  responses. A catalog integrity or audit loss fails closed.

## Private storage and setup

Build the WebAdmin with `npm ci && npm run build`, then provision the
**existing** operator-only TOTP, replay, and durable audit stores per
[Stage I](BETA_0.4_STAGE_I.md). Configure additional environment variables
on the separately installed gateway systemd unit:

```ini
Environment=DC24H_REMOTE_ORIGIN=https://localhost:8443
Environment=DC24H_REMOTE_RP_ID=localhost
Environment=DC24H_REMOTE_PASSKEY_FILE=/var/lib/dc24h-remote/passkeys.json
```

The parent directory must be owned by the gateway UID with mode 0700.
The gateway creates the new credential catalog as 0600, refuses symlinks,
hard links, corrupt/oversized files and unexpected outside changes, and
atomically replaces and fsyncs updates and their parent directory. Only one
gateway writer is supported. Keep the catalog, private TOTP files and audit
chain together in verified encrypted operator backups. Never place any of
them in Git, the WebAdmin static root or public Apache paths.

The provided Apache2/systemd files remain **examples only** and are not
installed or enabled by build. The new read-only hub screen still has no
remote hub write authority; only the credential inventory can be changed by
an authorized, freshly signed-in account.

## Enrollment and device actions

1. Verify the operator's active administrator/Owner role in the C++ database.
   Sign in locally with password+TOTP or password+existing passkey.
2. Within 60 seconds, choose **Add passkey**. The authenticator must confirm
   user presence and local user verification; the challenge expires after
   60 seconds and cannot be replayed. The server rejects a key already bound
   to another account or a ninth active key.
3. Use **Refresh devices** to inspect registered keys. A name is display-only
   (max 64 safe characters), not an identity or grant. Rename/revoke require
   the session's CSRF token and recent authentication.
4. **Revoke** permanently disables the selected credential, records an audit
   intent/outcome and ends all browser sessions for that actor. Do not restore
   an older credential catalog without operator-reviewed session revocation.

## Lost devices / offline account recovery

If TOTP or another passkey is still available, the operator can sign in and
revoke the missing key. If all factors are lost, never introduce a browser
password-only recovery bypass:

1. Stop the local gateway and disable any private SSH pilot. Independently
   verify the account owner and obtain **two distinct operator approvals**,
   recorded outside the application; the CLI does not itself prove that those
   checks happened. Preserve a verified protected backup of the credential
   catalog, TOTP enrollment/replay files and audit chain together.
2. In a trusted owner-only directory (0700) create a 0600 JSON request file,
   without tokens, passwords, secrets or device IDs, for example:

   ```json
   {"schema":1,"actor":"7","approvers":["operator-one","operator-two"]}
   ```

3. While the gateway is **stopped**, run as its service UID:

   ```sh
   node --import tsx server/remote-passkey-recovery.ts \
     --catalog /var/lib/dc24h-remote/passkeys.json \
     --rp-id localhost --audit /var/lib/dc24h-remote/audit.jsonl \
     --request /private/operator/passkey-recovery.json --offline-ack
   ```

4. The tool appends durable non-identifying recovery intent/outcome events
   and revokes every active passkey for that actor. If auditing fails, stop
   and investigate; an outcome after a partial write must not be assumed.
   Use the Stage I offline TOTP recovery procedure separately if necessary,
   preserving anti-replay state. Restart the gateway only after reviewing the
   audit chain and file permissions. Confirm old keys fail and re-enroll new
   factors under a freshly authenticated session.

The audit chain is unkeyed and detects many accidental losses, **not** a
privileged host attacker; retain independent off-host checkpoints. Recovery
may require human incident response and is not an automatic availability
promise.

## Verification and release gate

Target platforms: Ubuntu 22.04, 24.04, 26.04 and Debian 12/13. Operator
reference machine: Debian 13 Trixie, Xeon D-1521 (8 × 2.7 GHz), 31,997 MiB
RAM. C++ build, CTest, sanitizers, WebAdmin typecheck/build, Node tests,
browser E2E and Apache negative integration require validation on relevant
machines before merge; a local syntax check is **not** that validation.

```sh
cd webadmin
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Crypto unit tests exercise real ES256 attestation/assertion, wrong Origin,
challenge, replay, cross-account and revoked credential cases. API tests
cover one-time cookies, CSRF, TOTP fallback and actor-wide session revocation.
Review dependency advisories and isolate real hardware enrollment tests.

Push each logical patch separately, and report its SHA, PR/CI URL and
current pending/success/failure state without waiting for GitHub CI to end.
Do **not** merge while required CI remains pending/failed, and do not deploy
or expose WebAdmin publicly without a separate explicit go/no-go review.

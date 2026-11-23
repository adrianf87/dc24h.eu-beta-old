# dc24h.eu High Starter

Direct Connect Hub server implemented in C++20 for Linux (Debian and Ubuntu).

**Current development version: beta-0.4.16 (Stage IV: beta-0.4.13–beta-0.4.16; security tests, isolated measurement and recovery tooling, and manual release-candidate gates; not a production release).**

- **beta-0.4.13–beta-0.4.16 Stage IV — security tests and release preparation**: exercise denied WebAuthn, session and cross-account paths; supply bounded loopback-only ADC/ADCS, HTTPS and read-only API measurement tools; rehearse private-state backup and offline restore into a new directory; align release metadata and manual approval gates. **Performance, database recovery, RPO/RTO and independent review on Debian 13 remain pending.** No schema/protocol changes, public WebAdmin, hub-control writes or automatic deployment. [Stage IV release review](doc/us/BETA_0.4_STAGE_IV.md) | [PL](doc/pl/BETA_0.4_STAGE_IV.md).

- **beta-0.4.9–beta-0.4.12 Stage III — sessions and infrastructure**: rotate the HttpOnly/Secure/SameSite session cookie and CSRF after passkey enrollment or device rename; refuse concurrent revoked-session mutations. Use private HMAC-keyed, fsynced login/rate budgets across gateway restarts; fail closed on storage loss. Strengthen the localhost-only Apache TLS/SNI/Origin edge and its negative integration tests. Re-verify the durable audit chain periodically and send nonidentifying, cooldown-limited security warnings to journald. No new MariaDB schema, ADC/ADCS change, public WebAdmin, hub-control route or automatic deployment. [Stage III technical/operator guide](doc/us/BETA_0.4_STAGE_III.md) | [PL](doc/pl/BETA_0.4_STAGE_III.md).

- **beta-0.4.5–beta-0.4.8 Stage II — passkeys and devices**: add fixed-origin WebAuthn credential verification, a private fsynced credential catalog, password + passkey second-factor login, one-time enrollment challenges, device listing/renaming/revocation, actor-wide session invalidation and controlled offline recovery. C++ remains the password/role authority; this is **not passwordless**. No new MariaDB migration, public listener, remote hub writes or automatic deployment. [Stage II technical/operator guide](doc/us/BETA_0.4_STAGE_II.md) | [PL](doc/pl/BETA_0.4_STAGE_II.md).

- **beta-0.4.1–beta-0.4.4 Stage I — security foundations** (branch `beta-0.4.1-0.4.4-stage1`): close beta-0.3 CI regressions; document local trust boundaries and future WebAuthn; implement offline TOTP replacement/recovery with preserved replay state, and a private fsynced audit chain with explicit loss detection and fail-closed logins. No public listener, WebAuthn ceremony, remote administrative write, migration, merge or deployment. [Stage plan](doc/us/BETA_0.4_STAGE_I.md) | [PL](doc/pl/BETA_0.4_STAGE_I.md).

CI on `main`: [self-hosted Linux runner with isolated Docker Debian 12/13 and Ubuntu 22.04/24.04/26.04 environments](doc/us/GITHUB_CI.md) runs C++ Debug, C++ Release, sanitizers, WebAdmin and Stage IV checks. [Runner configuration](self-hosted-runner/README.md) · [PL](doc/pl/GITHUB_CI.md).

Development increments (older bullets describe their original delivery scope; verify CI and merge status separately):

- **beta-0.3.11–beta-0.3.12 Stage IV — series finish** (same branch `beta-0.3.1-12-full`): add bounded concurrent login/anonymous request and 64-read API-fault/recovery regressions; move gateway audit to a tested fixed-event, nonsecret JSON format; align all active version/fixture expectations with `beta-0.3.12`; add CTest release-scope safeguards and a bilingual manual approval/rollback checklist. No load-capacity claim, automatic deployment, new branch, public endpoint, schema/protocol change or merge to `main`. See [Release review](doc/us/RELEASE_BETA_0.3.md) | [PL](doc/pl/RELEASE_BETA_0.3.md).
- **beta-0.3.8–beta-0.3.10 Stage III** (same branch `beta-0.3.1-12-full`): strengthen localhost HTTPS with forward-secret TLS 1.2 AEAD suites and privacy headers; tighten optional systemd sandbox while preserving loopback and private API; document an operator-run SSH *local* forwarding pilot with verified server certificates and a credential-free, fixed-route preflight test. Final Stage III version `beta-0.3.10`. No Internet-facing listener, automatic deployment, public proxy, remote write, migration or new branch. See [Pilot](doc/us/REMOTE_PILOT.md) | [PL](doc/pl/REMOTE_PILOT.md).
- **beta-0.3.4–beta-0.3.7 Stage II** (same branch `beta-0.3.1-12-full`): require six-digit TOTP as a second factor after password/role verification; store per-account secrets in owner-only files and persist consumed steps to prevent OTP replay after restart. Require MFA-marked browser sessions, clear entered credentials, and write fixed-schema audit events to the service journal. Keep HTTPS loopback, read-only routes, CSRF, limits and public-access prohibition. Runtime version `beta-0.3.7`; no new branch, MariaDB migration or deployment. See [Beta development plan](doc/us/BETA.md) | [PL](doc/pl/BETA.md).
- **beta-0.3.1–beta-0.3.3 Stage I** (single branch `beta-0.3.1-12-full`): update release metadata and GitHub CI without assuming a fixed runner CPU count; apply one strict JSON media-type policy to all local C++ API adapters and scrub buffered private responses on success, denial, abort and oversize; extend negative tests; add ASan/UBSan security checks and a production-dependency advisory gate. The final Stage I runtime version is `beta-0.3.3`. No MFA, public WebAdmin, remote write, MariaDB migration, protocol change or deployment is introduced. See [Beta development plan](doc/us/BETA.md) | [PL](doc/pl/BETA.md).
- **beta-0.2.7–beta-0.2.12 Consolidated hardening** (single branch `beta-0.2.7-beta-0.2.12-finish`): update High Starter branding and release/CI documentation; extend session-eviction and concurrent-revocation tests; bound private API calls by an absolute deadline, enforce an exact JSON media type and scrub truncated/private response buffers; refuse cross-site Fetch Metadata at the Apache boundary; run failure/recovery regression tests and verify the final version on all build targets. The fixed five routes, local-only read-only behavior, schema v11, package tuple `0.1.0`, public vhost and ADC/ADCS are unchanged. See [Remote gateway](doc/us/REMOTE_GATEWAY.md) | [PL](doc/pl/REMOTE_GATEWAY.md).
- **beta-0.2.6 Status projection privacy**: the local-only remote WebAdmin now uses a dedicated server-side parser of the approved aggregate counters, not the full administrative status parser. Unknown private fields and changed unrelated status sections are never serialized to the browser; missing/invalid public counters, changed schema, unsafe numbers and API outages fail closed with 503 and no stale metrics. New socket-free tests cover privacy, malformed upstream data and recovery. The five read-only routes, login security, schema v11 and existing public Apache remain unchanged. See [Remote gateway](doc/us/REMOTE_GATEWAY.md) | [PL](doc/pl/REMOTE_GATEWAY.md).
- **beta-0.2.5 Apache2/HTTPS/loopback boundary**: the dedicated loopback TLS Apache example now refuses unknown Host, invalid route methods, query strings and unsafe Origin before proxying; blocks the regular admin `index.html` and `local-*` assets from the remote vhost; caps incoming request bodies. Disposable Apache regression tests cover negative requests, secrets and plaintext attempts. The existing public vhost is untouched. No Internet exposure without MFA, administrative write, schema migration or deployment. See [Remote gateway](doc/us/REMOTE_GATEWAY.md) | [PL](doc/pl/REMOTE_GATEWAY.md).
- **beta-0.2.4 Sessions and CSRF**: rotates browser sessions on successful re-login (invalidating the old cookie), starts the 10-minute absolute lifetime after password proof and permission verification complete, and adds deterministic tests for 2-minute idle/10-minute absolute expiry, four concurrent browser sessions, one-time challenges, CSRF/Origin, logout/replay, late status responses and process restart. Follow-up race fixes refuse concurrent re-logins whose predecessor was already replaced or logged out; UI requests from an earlier authentication generation cannot overwrite or revoke the new session, and failed challenges do not retain the entered password. Browser regressions cover expiration and out-of-order responses. Cookies remain Secure/HttpOnly/SameSite=Strict and scoped to /remote/v1. Still local-only, read-only and public-disabled, without a new route, migration, public proxy or ADC/ADCS change. See [Remote gateway](doc/us/REMOTE_GATEWAY.md) | [PL](doc/pl/REMOTE_GATEWAY.md).
- **beta-0.2.3 Authentication and revalidation** (including `beta-0.2.3-fix`): rejects mismatched upstream account identities and late status responses after concurrent session revocation. The follow-up also refuses expired CSRF login challenges when a POST body arrives late, and denies protected API results if the browser session expires during asynchronous authorization or status reads. Socket-free regression tests cover administrator/Owner logins, generic refusals, role/grant revocation, API outages, concurrent reads, expiration and login limits. The application stays on `beta-0.2.3` with five fixed local-only, read-only routes; no public access, administrative writes, MariaDB migration or ADC/ADCS protocol changes. See [Remote gateway](doc/us/REMOTE_GATEWAY.md) | [PL](doc/pl/REMOTE_GATEWAY.md).
- **beta-0.2.2 HTTP request hardening**: preserves the five exact remote gateway routes, rejects untrusted proxy headers by family and adds negative method/path/body tests. Work is on `beta-0.2-code`; no new permissions, Internet access or writes. See [Remote gateway](doc/us/REMOTE_GATEWAY.md) | [PL](doc/pl/REMOTE_GATEWAY.md).
- **beta-0.2.1 Maintenance baseline**: reports `beta-0.2.1` across the hub, API, service controller and WebAdmin while retaining the beta-0.2 local-only, read-only gateway. No new remote permissions, public network listener, database migration or production deployment. See [Beta maintenance baseline](doc/us/BETA.md) | [PL](doc/pl/BETA.md).
- **beta-0.2 Remote WebAdmin**: isolated loopback-only HTTPS portal, authenticated administrator/Owner password proof, bounded server-side sessions with CSRF and live role revalidation, and an explicit allowlist of aggregate status metrics. No public exposure without MFA, no administrative writes or service commands. See [Remote gateway](doc/us/REMOTE_GATEWAY.md) | [PL](doc/pl/REMOTE_GATEWAY.md).
- **beta-0.1.8 Development baseline**: the hub, API and WebAdmin report `beta-0.1.8`, carrying forward beta-0.1.7 service controls and the fixes already merged to `main`. No new functionality, migration or production deployment is included. See [Beta development baseline](doc/us/BETA.md) | [PL](doc/pl/BETA.md).
- **beta-0.1.7 Hub WebAdmin**: local Owner-only service status and Start/Stop/Restart controls with explicit warnings, confirmation, progress, failure handling, recent online-user observations and access to the audited action history. The public Apache proxy does not expose these routes. See [Hub WebAdmin](doc/us/HUB_WEBADMIN.md) | [PL](doc/pl/HUB_WEBADMIN.md).
- **beta-0.1.6 Service operations**: the separate maintenance API validates the live Owner grant, session, CSRF and an explicit confirmation, then instructs a dedicated systemd controller to Start, Stop or Restart only `dc24h.service`. Migration v11 records durable audit intentions and verified outcomes. No WebAdmin controls were added at this stage. See [Service operations](doc/us/SERVICE_OPERATIONS.md) | [PL](doc/pl/SERVICE_OPERATIONS.md).
- **beta-0.1.5 Service controller**: a separate, local-only, Unix-socket status process reads the fixed systemd `dc24h.service` state even with the hub stopped. It has no Start/Stop/Restart commands or public API. See [Service controller](doc/us/SERVICE_CONTROLLER.md) | [PL](doc/pl/SERVICE_CONTROLLER.md).
- **beta-0.1.4 Configuration editor**: local-only WebAdmin review, validation, change preview, confirmed save and backup restore for four nonsecret settings with PL/US interface and restart warning. No live reload or service commands. See [Configuration editor](doc/us/CONFIGURATION_EDITOR.md).
- **beta-0.1.3 Configuration storage**: privileged local maintenance write/restore with revision conflicts, atomic INI replacement, private backup/undo and v10 audit intentions/outcomes. See [Configuration write](doc/us/CONFIGURATION_WRITE.md).
- **beta-0.1.2 Configuration review**: branch `beta-0.1.2` adds privileged local read-only saved/maintenance-active comparisons, allowlisted in-memory proposal validation and stale-file detection. No file writes, WebAdmin editor, hub control or migration. See [Configuration review](doc/us/CONFIGURATION_REVIEW.md).
- **beta-0.1.1 Management foundation**: the hub reports `beta-0.1.1`. The management catalog is schema 2. `POST /api/v1/management/authorize` checks the grant and returns `not_implemented`. `configuration.manage` and `hub.manage` stay unimplemented. Schema v9 is unchanged. This is not a production release. See [Management foundation](doc/us/MANAGEMENT_FOUNDATION.md).
- **beta-0.1 Beta baseline**: the hub reports `beta-0.1` and keeps the alpha-0.9.17 behavior. Schema v9 is unchanged. This is not a production release. See [Beta baseline](doc/us/BETA.md).

<details>
<summary>Alpha 0.9.x (17 releases)</summary>

- **alpha-0.9.17 CI and dependencies**: the hub binaries, the WebAdmin lockfile and the registered security tests are checked from the existing test jobs. This is not a vulnerability database. See [Dependencies](doc/us/DEPENDENCIES.md).
- **alpha-0.9.16 Stress testing**: a fixed in-process soak repeats the existing frame, peer, login, chat and session limits. Refusals stay on and occupancy returns to zero. This is not a capacity claim or a load test. See [Stress testing](doc/us/STRESS.md).
- **alpha-0.9.15 Memory safety**: AddressSanitizer, UndefinedBehaviorSanitizer and ThreadSanitizer are separate build modes. The normal build is unchanged. See [Memory safety](doc/us/MEMORY_SAFETY.md).
- **alpha-0.9.14 Optimization**: routed frames use one allocation, and the welcome list keeps the encoding already measured. ADC bytes stay the same. See [Optimization](doc/us/OPTIMIZATION.md).
- **alpha-0.9.13 Profiling**: a fixed in-process ranking of permission, moderation and role decisions from alpha-0.8. The slowest stage is named. This is not a sampling profiler or a capacity claim. See [Profiling](doc/us/PROFILING.md).
- **alpha-0.9.12 Benchmark**: a fixed in-process measurement of permission and moderation decisions from alpha-0.8. This is not a capacity claim or a load test. See [Benchmark](doc/us/BENCHMARK.md).
- **alpha-0.9.11 Monitoring**: one process sample and session gauges appear on the existing bearer-only status route. This is not a host monitor or a stored history. See [Monitoring](doc/us/MONITORING.md).
- **alpha-0.9.10 Logging security**: a log file stays mode 0600 and owned by the hub user. Fixed security outcomes are recorded without peer data. This is not a production audit. See [Logging security](doc/us/LOGGING_SECURITY.md).
- **alpha-0.9.9 System security**: one systemd example runs the hub as a locked system user with an empty capability set and a strict read-only filesystem. The build does not install or start that service. See [System security](doc/us/SYSTEM_SECURITY.md).
- **alpha-0.9.8 Database security**: one explicit command writes a consistent owner-only snapshot and restores it only into empty tables of the same schema. A lost acknowledgement is not replayed. Off-host copies stay with the operator. See [Database security](doc/us/DATABASE_SECURITY.md).
- **alpha-0.9.7 API security**: every maintenance call except the password proof requires the session id and the CSRF secret from the same slot. A grant alone no longer reads. Copying all three values from page memory still works until the slot ends. See [API security](doc/us/API_SECURITY.md).
- **alpha-0.9.6 Account security**: enrollment refuses an ADC password identical to the account password, and the reactor decrypts that password only after the account ban check and the per-account attempt budget. Online guessing and a captured PAS with require_tls off remain separate. See [Account security](doc/us/ACCOUNT_SECURITY.md).
- **alpha-0.9.5 TLS security**: the hub refuses an expired, not-yet-valid or weak leaf certificate before listen, and offers only TLS 1.2 and 1.3 AEAD. Clients still check the name and the trust chain. HTTP/2, OCSP and automatic renewal remain separate work. See [TLS security](doc/us/TLS_SECURITY.md).
- **alpha-0.9.4 Traffic limits**: each ready session may send 8 INF updates at once, then 4 per second. A denial is one recoverable status per second and does not disconnect or relay. Chat, search and transfer budgets stay. A bandwidth cap remains separate work. See [Traffic limits](doc/us/TRAFFIC_LIMITS.md).
- **alpha-0.9.3 Network security**: the listen backlog is 128. Each accepted socket the hub keeps gets kernel send and receive buffers of 65536 bytes and a TCP user timeout equal to the idle timeout. Existing application timeouts and output queues stay. A bandwidth cap remains separate work. See [Network security](doc/us/NETWORK_SECURITY.md).
- **alpha-0.9.2 ADC security**: the hub command profile is one function, called before session state changes. A deterministic in-process fuzz campaign locks the parser, the stream decoder and that profile. Unknown extensions still parse. Coverage-guided fuzzing remains separate work. See [ADC security](doc/us/ADC_SECURITY.md).
- **alpha-0.9.1 Threat model**: a written analysis of assets, actors, trust boundaries and residual risk for the hub and local WebAdmin. It adds no control, schema change or public gateway. See [Threat model](doc/us/THREAT_MODEL.md).

</details>

<details>
<summary>Alpha 0.8.x (15 releases)</summary>

- **alpha-0.8.15 Security sessions**: each in-memory maintenance grant carries a public session id and a separate CSRF secret. Writes require both on that same slot. Each session accepts 24 requests in 10 seconds. Reads stay grant-only. The values stay in process memory, not in SQL, cookies or web storage. A public authenticated gateway remains separate work. See [Security sessions](doc/us/SECURITY_SESSIONS.md).
- **alpha-0.8.14 Apache2 HTTPS proxy**: an allowlisted reverse proxy to the loopback WebAdmin adapter, with client bearer tokens, cookies and forwarded identity removed. The service token and the C++ Unix socket stay out of Apache. Local access remains the default. See [Apache2 HTTPS proxy](doc/us/APACHE2_PROXY.md).
- **alpha-0.8.13 WebAdmin Management**: a maintenance catalog of account, role and ban areas for the current grant, and a bilingual page that links to the existing flows. The page does not perform those writes. Configuration writes, live hub administration and browser kick or mute stay outside it. See [WebAdmin Management](doc/us/WEBADMIN_MANAGEMENT.md).
- **alpha-0.8.12 WebAdmin Users**: a bearer-only directory of ready sessions and a bilingual page of kick, mute and unmute decisions. The page shows the client command and does not send it, create bans, or reveal CID, IP, account or profile fields. See [WebAdmin Users](doc/us/WEBADMIN_USERS.md).
- **alpha-0.8.11 WebAdmin Dashboard**: a fixed read-only summary of existing process counters on the authenticated status API, and a bilingual main panel. Account lists, ban records, audit rows, configuration writes and live hub administration stay outside it. See [WebAdmin Dashboard](doc/us/WEBADMIN_DASHBOARD.md).
- **alpha-0.8.10 Admin API**: a password proof issues a short-lived in-memory grant. Maintenance reads and writes require that grant in addition to the process token. Status and health stay token-only. Configuration writes and live hub administration remain pending. See [Admin API](doc/us/ADMIN_API.md).
- **alpha-0.8.9 Audit Logs**: schema v9 records successful account, ownership and ban maintenance. An active account with audit.read lists that history. Refusals, passwords, proofs, free-text reasons and live kick or mute stay outside the table. See [Audit Logs](doc/us/AUDIT_LOGS.md).
- **alpha-0.8.8 Moderation Rules**: one allocation-free check of the actor permission and the operation target for kick, mute, unmute, account/CID/IP bans and ban revocation. Schema v8 is unchanged. See [Moderation Rules](doc/us/MODERATION_RULES.md).
- **alpha-0.8.7 Mute**: independent live public/private chat mute, authenticated role hierarchy, +mute/+unmute, session lifetime and bilingual read-only monitoring. Schema v8 is unchanged. See [Mute](doc/us/MUTE.md).
- **alpha-0.8.6 Temporary Bans**: relative durations, automatic admission expiry, filtered history and server-clock WebAdmin countdown. Schema v8 is unchanged. See [Temporary Bans](doc/us/TEMPORARY_BANS.md).
- **alpha-0.8.5 Ban Core**: persistent account/CID/exact-IP blocks, permanent/expiring admission policy, proven maintenance create/revoke, WebAdmin and explicit schema v8. See [Ban Core](doc/us/BAN_CORE.md).

- **alpha-0.8.4 Kick**: authenticated `+kick <nickname> [reason]`, strict role hierarchy, private terminal ADC notices, immediate routing/search cleanup and read-only WebAdmin counters. See [Kick](doc/us/KICK.md).

- **alpha-0.8.3 Admin Core**: central maintenance dispatch for eight account/ownership actions, fixed result classification, safe discovery and process counters in WebAdmin. See [Admin Core](doc/us/ADMIN_CORE.md).

- **alpha-0.8.2 Operators**: SQL-filtered staff directory, first-Owner provisioning and dual-proof atomic ownership transfer through a private local CLI. Schema v7 is unchanged. See [Operators](doc/us/OPERATORS.md).

- **alpha-0.8.1 Permissions**: seven-role hierarchy, seventeen exact capabilities, constrained VIP delegation, stronger-role enforcement, transactional maintenance role assignment and explicit schema v7. See [Permissions](doc/us/PERMISSIONS.md).


</details>

<details>
<summary>Alpha 0.7.x (15 releases)</summary>

- **alpha-0.7.15 Configuration**: validated database/login policy, shared effective timeouts, a redacted CLI preview and bilingual read-only WebAdmin startup configuration. See [Database and Login Configuration](doc/us/DATABASE_AUTH_CONFIGURATION.md).

- **alpha-0.7.14 WebAdmin Accounts**: paginated account metadata and confirmed registration, activation, disable, reset and password changes through a separate local maintenance API. See [WebAdmin Accounts](doc/us/WEBADMIN_ACCOUNTS.md).

- **alpha-0.7.13 Database Resilience**: independent connection/read/write timeouts, explicit single-attempt reconnect with fresh credentials, transaction-scope guards and real MariaDB outage/restart tests. See [Database Resilience](doc/us/DATABASE_RESILIENCE.md).

- **alpha-0.7.12 Anti-Bruteforce**: bounded global/IP/account token buckets shared by ADC/ADCS and reconnects, generic refusal, automatic refill and fixed private log events. See [Anti-Bruteforce](doc/us/ANTI_BRUTEFORCE.md).

- **alpha-0.7.11 Account Management**: trusted atomic password change, administrator disable/reset with fresh proof and revision checks, ADC credential invalidation and explicit maintenance restart/reenrollment. See [Account Management](doc/us/ACCOUNT_MANAGEMENT.md).

- **alpha-0.7.10 Roles**: validated account roles in ready sessions, fixed search/transfer grants and staff session-revocation hierarchy; global policies and explicit session restrictions remain enforced. See [Roles](doc/us/ROLES.md).

- **alpha-0.7.9 Auth Sessions**: managed connection/account binding after PAS and final welcome LF, ready-only trusted lookups, bounded account-filtered pages and immediate connection revocation/cleanup. See [Auth Sessions](doc/us/AUTH_SESSIONS.md).

- **alpha-0.7.8 ADC Authentication**: account-backed GPA/PAS, separate AES-256-GCM encrypted ADC passwords with an external private key, unchanged scrypt credentials and ADCS by default. See [ADC Authentication](doc/us/ADC_AUTHENTICATION.md).
- **alpha-0.7.7 Password Security**: strict fixed-cost verifier decoding, credential checks without secret-bearing results, constant-time key comparison and cleansed owned buffers. See [Password Security](doc/us/PASSWORD_SECURITY.md).

- **alpha-0.7.6 Identity Mapping**: immutable account/nickname/CID bindings in MariaDB, exact-pair resolution, conflict-safe writes and explicit schema v5. See [Identity Mapping](doc/us/IDENTITY_MAPPING.md).

- **alpha-0.7.5 Registration**: atomic registered/disabled account and salted scrypt verifier creation through a trusted C++ API; bounded Unicode inputs, fixed costs and fault-tested rollback. See [Registration](doc/us/REGISTRATION.md).

- **alpha-0.7.4 Account Repository**: MariaDB account metadata storage, generated IDs, byte-exact unique names, safe row imports and transactional revision checks. See [Account Repository](doc/us/ACCOUNT_REPOSITORY.md).

- **alpha-0.7.3 Account Model**: independent checked persistent-account metadata, Unicode names, roles/status, UTC audit times and immutable candidates with allocation-safe ownership. See [Account Model](doc/us/ACCOUNT_MODEL.md).
- **alpha-0.7.2 Database Migrations**: ordered compiled SQL catalog, exact checksums, legacy metadata upgrade, read-only schema status and durable partial-migration detection without blind DDL replay. See [Database Migrations](doc/us/DATABASE_MIGRATIONS.md).
- **alpha-0.7.1 Database Core**: typed MariaDB parameters, bounded owning results, write metadata and owner-thread RAII transactions, with deterministic conflict/loss/fault tests and database-enabled real ncdc. See [Database Core](doc/us/DATABASE_CORE.md).

</details>

<details>
<summary>Alpha 0.6.x (13 releases)</summary>

- **alpha-0.6.13 Configuration**: exact bounded peer-protocol policy, existing count/byte limits and all effective transfer settings in the authenticated API and US/PL Connections page. See [Transfer Configuration](doc/us/TRANSFER_CONFIGURATION.md).
- **alpha-0.6.12 WebAdmin**: observed CTM/RCM request, refusal and queue-copy rates, bounded browser-local chart/table, restart/outage recovery and EN/PL controls. See [WebAdmin Transfer Monitoring](doc/us/WEBADMIN_TRANSFERS.md).
- **alpha-0.6.11 Transfer Statistics**: saturating CTM/RCM outcomes, queue/error and peer-report counters in the authenticated API and US/PL Connections page. See [Transfer Statistics](doc/us/TRANSFER_STATISTICS.md).
- **alpha-0.6.10 Transfer Limits**: shared CTM/RCM source and aggregate recipient count/byte budgets, bounded private notices, monotonic refill and real ncdc recovery. See [Transfer Limits](doc/us/TRANSFER_LIMITS.md).
- **alpha-0.6.9 Error Handling**: centralized connection diagnostics, immutable shared STA routing with fixed lifetime audiences, allocation/queue fault isolation and disconnect/reset recovery. See [Error Handling](doc/us/ERROR_HANDLING.md).
- **alpha-0.6.8 Connection Security**: shared endpoint/port checks, configurable CTM/RCM and guest permissions, trusted lifetime grants, dispatch/echo authorization rechecks and real ncdc denial/recovery tests. See [Connection Security](doc/us/CONNECTION_SECURITY.md).
- **alpha-0.6.7 Transfer Tokens**: one bounded opaque connection-token policy, owning typed values, exact CTM/RCM/error forwarding and real ncdc boundary-token handshakes. See [Transfer Tokens](doc/us/TRANSFER_TOKENS.md).
- **alpha-0.6.6 Client Capabilities**: owning per-family TCP modes and advisory peer protocols, shared CTM/RCM admission, pure originator path selection and live INF mode changes with real ncdc. See [Client Capabilities](doc/us/CLIENT_CAPABILITIES.md).
- **alpha-0.6.5 Protocol Negotiation**: typed ADC/1.0 and ADCS/1.0 intent, capability/preference selection with required-TLS refusal, lossless peer negotiation errors and real ncdc TLS peer handshakes. See [Protocol Negotiation](doc/us/PROTOCOL_NEGOTIATION.md).
- **alpha-0.6.4 Connection Routing**: one CTM/RCM SID router with immutable fixed recipient lifetimes, shared packets and queues; parallel pairs sharing a token stay isolated. See [Connection Routing](doc/us/CONNECTION_ROUTING.md).
- **alpha-0.6.3 ADC RCM**: owning Reverse Connect To Me validation and live DRCM/ERCM routing, per-family passive/active roles, shared queues and real ncdc RCM→CTM peer handshakes. See [ADC RCM](doc/us/ADC_RCM.md).
- **alpha-0.6.2 ADC CTM**: owning Connect To Me validation and live DCTM target / ECTM target+source routing through Transfer Core, with active-source checks, shared bounded queues and real ncdc peer handshakes. See [ADC CTM](doc/us/ADC_CTM.md).
- **alpha-0.6.1 Transfer Core**: independent checked connection intents, IPv4/IPv6 active/passive roles and lifetime-bound one-attempt plans with cancel/revalidation. Live CTM/RCM and file transfers remain future stages. See [Transfer Core](doc/us/TRANSFER_CORE.md).

</details>

<details>
<summary>Alpha 0.5.x (13 releases)</summary>

- **alpha-0.5.13 WebAdmin**: browser-local search traffic rates, a bounded chart and accessible interval table, with pause/manual refresh, local clear and restart/outage recovery. See [WebAdmin Search Monitoring](doc/us/WEBADMIN_SEARCH.md).
- **alpha-0.5.12 Configuration**: 19 aggregate SCH/RES counters, tracked token windows and all 16 effective search settings in the authenticated read-only API and US/PL WebAdmin Search page. See [Search Configuration and Statistics](doc/us/SEARCH_CONFIGURATION.md).
- **alpha-0.5.11 Search Security**: independent query/result/recipient count and byte quotas, bounded denials, guest/global permissions and trusted session grants, configurable active-search windows and optional strict result tokens. See [Search Security](doc/us/SEARCH_SECURITY.md).
- **alpha-0.5.10 Active/Passive**: checked public endpoint projection, independent IPv4/IPv6 TCP/UDP modes and reply paths in Search Core/plans, dynamic INF transitions, passive hub fallback and actual ncdc UDP interoperability. See [Active/Passive](doc/us/ACTIVE_PASSIVE.md).
- **alpha-0.5.9 Result Routing**: target-only ADC/ADCS DRES delivery with ready session lifetimes, active owner-token/generation checks, tokenless compatibility and bounded output queues. Real ncdc interoperability covers both receiving and producing results. See [Result Routing](doc/us/RESULT_ROUTING.md).
- **alpha-0.5.8 ADC RES**: typed DRES parser and live ADC/ADCS validation, bounded names/sizes/slots/tokens/TTH, recoverable private errors and real ncdc compatibility. Result routing and correlation remain future stages. See [ADC RES](doc/us/ADC_RES.md).
- **alpha-0.5.7 Feature Routing**: compiled exact FSCH selectors, current public INF SU matching, SUP independence, live capability changes and positive/negative fanout verified with ADC/ADCS and ncdc. See [Feature Routing](doc/us/FEATURE_ROUTING.md).

- **alpha-0.5.6 Search Routing**: real ADC/ADCS B/F/D/E SCH delivery, feature/lifetime checks, immutable shared packets, bounded queues and active-token lifecycle. Actual ncdc tests verify delivery to another client. RES/result routing remains a later stage. See [Search Routing](doc/us/SEARCH_ROUTING.md).
- **alpha-0.5.5 Search Tokens**: bounded session-lifetime/TO registration, local generations, expiration/cancellation and active-search Core APIs with rollback and allocation-free lookup/dispatch. Live result correlation/routing remains a later stage. See [Search Tokens](doc/us/SEARCH_TOKENS.md).
- **alpha-0.5.4 TTH Search**: exact 192-bit file-root predicates, hash-only and combined queries, lossless SCH/Core/descriptor projection and actual ncdc ADC/ADCS TTH tests. Live request/result routing remains a later stage. See [TTH Search](doc/us/TTH_SEARCH.md).
- **alpha-0.5.3 Search Filters**: compiled Unicode name/path, extension, size and type predicates over checked descriptors, filter-only Core queries and allocation-free matching. Routing/results remain later stages. See [Search Filters](doc/us/SEARCH_FILTERS.md).
- **alpha-0.5.2 ADC SCH**: typed owning search-request parsing, field/selector/TR validation and real ADC/ADCS reception with bounded, payload-free diagnostics. Routing/results remain later stages. See [ADC SCH](doc/us/ADC_SCH.md).
- **alpha-0.5.1 Search Core**: independent C++20 textual query validation, immutable lifetime-bound recipient plans, feature selection and bounded dispatch. Live SCH/RES adapters and search results remain future stages. See [Search Core](doc/us/SEARCH_CORE.md).

</details>

<details>
<summary>Alpha 0.4.x (12 releases)</summary>

- **alpha-0.4.12 WebAdmin**: dedicated Chat statistics page with all nine aggregate counters, message/recipient queue definitions, US/PL navigation, live refresh, honest unavailable states and safe snapshot export. See [WebAdmin chat statistics](doc/us/WEBADMIN_CHAT.md).
- **alpha-0.4.11 Chat Logging**: opt-in payload-free outcome logs with a separate rate budget, saturating aggregate B/D/E chat counters, authenticated API and bilingual WebAdmin metrics. See [Chat Logging](doc/us/CHAT_LOGGING.md).
- **alpha-0.4.10 Chat Configuration**: checked startup `[chat]` settings for decoded text size, independent public/private/actions and optional/custom welcome, alongside existing Anti-Flood limits. Defaults retain previous behavior; disabled/oversized legal chat gets recoverable refusals. See [Chat Configuration](doc/us/CHAT_CONFIGURATION.md).

- **alpha-0.4.9 Anti-Flood**: enabled per-connection message/decoded-byte buckets for BMSG/DMSG/EMSG with configurable `[chat]` rates/bursts. Denied traffic has no fanout or echo; bounded recoverable notices permit later recovery. See [Anti-Flood](doc/us/ANTI_FLOOD.md).

- **alpha-0.4.8 Chat Validation**: shared text/SID/session validation for direct public/private adapter calls and routing. Ready sender ownership, bounded UTF-8/NFC text and complete message checks precede delivery plans; recipient and dispatch lifetime checks remain. See [Chat Validation](doc/us/CHAT_VALIDATION.md).

- **alpha-0.4.7 Hub Messages**: trusted system IMSG preparation and ready-session delivery, shared bounded output and a fixed guest welcome after own BINF. Clients cannot originate system messages. See [Hub Messages](doc/us/HUB_MESSAGES.md).

- **alpha-0.4.6 Message Flags**: shared typed PM/ME decoding and canonical parameter construction across the codec and public/private chat. Distinct absent/ME0/ME1 values, duplicate rejection and private-reply SID policy are covered by dedicated tests. See [Message Flags](doc/us/MESSAGE_FLAGS.md).

- **alpha-0.4.5 Message Routing**: central MSG scope selection and queue delivery, engine-bound plans and live session checks. Private/group/unsupported scopes cannot become public messages. See [Message Routing](doc/us/MESSAGE_ROUTING.md).

- **alpha-0.4.4 Private Chat**: DMSG target-only and EMSG target/sender delivery, deduplicated self-messages, source/PM checks and target lifetime binding. Private frames share immutable storage only between selected queues and never fall back to public delivery. See [Private Chat](doc/us/PRIVATE_CHAT.md).

- **alpha-0.4.3 Public Chat**: dedicated BMSG admission/projection/dispatch adapter with one immutable public frame shared by recipient queues. Independent offsets and logical charges preserve bounded FIFO delivery and pinned TLS output through partial sends, terminal close and source cleanup. See [Public Chat](doc/us/PUBLIC_CHAT.md).

- **alpha-0.4.2 Chat Core**: independent message engine with owned lifecycle-bound broadcast plans and live public BMSG delivery, including sender echo and /me. Unknown fields are removed; private intent is never downgraded to public. Existing bounded queues isolate slow/failing recipients. See [Chat Core](doc/us/CHAT_CORE.md).

- **alpha-0.4.1 ADC MSG**: dedicated MSG parsing/serialization, checked PM/ME flags, typed views/builders, exact escaped frame limits and live NORMAL/source validation. Actual ncdc public/action/private messages are tested; chat routing remains planned. See [ADC MSG](doc/us/ADC_MSG.md).


</details>

<details>
<summary>Alpha 0.3.x (13 releases)</summary>

- **alpha-0.3.13 Statistics**: constant-time session lifecycle counts, online/peak users and successful logins; closed/rejected connections, peak peers and application byte totals exposed through the authenticated local API and US/PL WebAdmin. See [Statistics](doc/us/STATISTICS.md).

- **alpha-0.3.12 Limits**: configurable shared connection/session/user ceilings, typed admission gates and user-capacity rejection before welcome/list publication. Slots remain reserved through closing until cleanup. See [Limits](doc/us/LIMITS.md).

- **alpha-0.3.11 User Disconnect**: allocation-free lifecycle finalization, ordered release of output/protocol/SID and public identity reservations, then bounded public QUI. Failed notifications cannot retain the departing user or a usable stale recipient. See [User Disconnect](doc/us/USER_DISCONNECT.md).

- **alpha-0.3.10 INF Updates**: transactional ready-state INF updates commit ADC metadata, User/profile and nickname ownership together. Public incremental deltas carry only validated supplied fields and cancellations; unknown/private data is excluded. See [INF Updates](doc/us/INF_UPDATES.md).

- **alpha-0.3.9 User List**: deterministic initial public-user synchronization, complete welcome wire-budget preflight, lifecycle filtering and owned snapshots with own INF last. Mixed ADC/ADCS clients and real ncdc synchronize lists across joins, updates and reconnect. See [User List](doc/us/USER_LIST.md).

- **alpha-0.3.8 User Login**: explicit verified ADC guest-to-session registration, typed rejection, transactional public indexes and identity-bound welcome completion. Readiness is published once after the own-INF final LF is sent. See [User Login](doc/us/USER_LOGIN.md).

- **alpha-0.3.7 User Registry**: bounded SID/CID indexes with one registration per session lifetime, transactional admission and owner-specific cleanup. SessionManager resolves both keys to the same live, read-only User. See [User Registry](doc/us/USER_REGISTRY.md).

- **alpha-0.3.6 Nick Manager**: bounded, owner-indexed nickname reservations, shared checked name validation, transactional rename and safe release by connection lifetime. Integrated with SessionManager and tested over ADC/ADCS. See [Nick Manager](doc/us/NICK_MANAGER.md).

- **alpha-0.3.5 User Core**: checked UTF-8/NFC nickname values, shared ADC/User text rules, immutable rename candidates and explicit verified public INF-to-User projection. Real ncdc logs in and reconnects with a Polish nickname. See [User Core](doc/us/USER_CORE.md).

- **alpha-0.3.4 Session Manager**: central SID/CID/nickname indexes, const model lookup and managed lifecycle/profile mutations. Identity reservations remain consistent through admission, rename, close and removal. See [Session Manager](doc/us/SESSION_MANAGER.md).

- **alpha-0.3.3 User Core**: owning public guest identity and bounded typed profile, composed with session lifecycle and validated ADC INF updates/cancellations. See [User Core](doc/us/USER_CORE.md).

- **alpha-0.3.2 Session Manager**: bounded central ownership of live session models, stable lookup, phase counts and ordered snapshot pages. ADC/ADCS register and remove every connection through the manager. See [Session Manager](doc/us/SESSION_MANAGER.md).

- **alpha-0.3.1 Session Core**: independent Users lifecycle model, stable local session IDs, public identity snapshots, monotonic transition times and typed closure causes. Live ADC/ADCS uses this model for readiness, deadlines and cleanup. See [Session Core](doc/us/SESSION_CORE.md).


</details>

<details>
<summary>Alpha 0.2.x (10 releases)</summary>

- **alpha-0.2.10 Security**: cumulative login input budgets, global/per-IP pending admissions and shared identity-attempt gates before Tiger validation. Tested with real ADC/ADCS and ncdc. See [negotiation security](doc/us/NEGOTIATION_SECURITY.md).

- **alpha-0.2.9 STA/QUI**: typed status/quit validation, precise protocol errors, bounded ISTA → own IQUI → close, safe B/D/E/F status routing and real ncdc rejection/recovery tests. See [STA/QUI](doc/us/ADC_STATUS.md).

- **alpha-0.2.8 Login**: complete guest ADC/ADCS login on the C++ hub, ordered bounded replies, unique nickname/CID admission, public user lists, INF updates and disconnect cleanup. Real ncdc reaches NORMAL and reconnects over both transports. See [guest login](doc/us/ADC_LOGIN.md).

- **alpha-0.2.7 CID/PID**: dedicated Tiger identity verifier, typed public CID/verified result, direct cleansed buffers, constant-time digest comparison and deterministic provider-failure tests. INF uses the shared verifier; Network attachment remains planned.

- **alpha-0.2.6 INF**: bounded client metadata, Tiger PID/CID verification, peer-address and field validation, transactional updates and public snapshots without PD. Composed ClientSession is tested with real ncdc; live transport attachment remains planned.

- **alpha-0.2.5 SID**: typed 20-bit base32 SID codec, bounded shared hub pool, move-only RAII reservations and SidSession composition with SUP/state. Real ncdc fixture uses allocated SIDs; live Network attachment remains planned.

- **alpha-0.2.4 SUP**: bounded feature AD/RM sets, BASE checks, TIGR session-hash selection, deterministic ISUP and composition with ADC State. Tested with real ncdc in an isolated fixture; Network attachment remains planned.

- **alpha-0.2.3 ADC State**: independent hub connection state machine, explicit validation gates, command/direction checks and source-SID binding. Transport wiring and full login remain planned.

- **alpha-0.2.2 ADC Parser**: BASE argument layouts, named-field syntax, bounded decimal integers, feature budgets and TCP/TLS recovery tests.

- **alpha-0.2.1 Project**: [alpha-0.1 audit](doc/us/AUDIT_ALPHA_0.1.md), prioritized alpha-0.2 acceptance plan, version/documentation checks and required CI integrations.


</details>

<details>
<summary>Alpha 0.1.x (11 releases)</summary>

- **alpha-0.1.11 Apache2**: customizable static WebAdmin HTTPS example, HTTP→HTTPS redirect, TLS 1.2/1.3, certificate paths and isolated HTTPS tests.

- **alpha-0.1.10 WebAdmin**: responsive React/TypeScript/Vite read-only panel, EN/PL, safe local development adapter, tests and an Apache2 static-preview example.

- **alpha-0.1.9 API**: optional local HTTP/JSON status and health routes, private Unix socket, same-UID access and Bearer authentication.

- **alpha-0.1.8 Database**: optional MariaDB connection, private password files, local Unix sockets, prepared queries and explicit migration metadata baseline.

- **alpha-0.1.7 Security**: bounded per-IP admissions, frame quotas and absolute TLS/unfinished-frame deadlines.

- **alpha-0.1.6 Logging**: startup summaries, WARN, opt-in connection events, bounded single-line UTF-8 records and rate budgets.

- **alpha-0.1.5 Configuration**: bounded UTF-8 INI, CLI overrides, port/limit/path checks and append-file logging.

- **alpha-0.1.4 ADCS**: optional nonblocking TLS 1.2+ listeners using OpenSSL.

- **alpha-0.1.3 ADC**: bounded stream parser, commands, UTF-8/NFC validation.

- **alpha-0.1.2 Network**: multiple nonblocking IPv4/IPv6 TCP listeners/clients.

- **alpha-0.1.1 Core**: lifecycle, signal handling, graceful shutdown.

</details>

Guest login, public user sessions, public chat and direct/echo private chat are implemented. Group chat, registered-user authentication, moderation/history, search, transfer coordination and a production authenticated web gateway remain future milestones.

## Build

```sh
sudo apt-get install build-essential cmake libutf8proc-dev libgcrypt20-dev libssl-dev openssl python3 ncdc libmariadb-dev
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 2
ctest --test-dir build --output-on-failure
./build/dc24h --version
```

## Run

```sh
# Guest ADC hub on loopback:
./build/dc24h --listen 127.0.0.1:1511

# TLS only (replace credentials with your own):
./build/dc24h --adcs-listen 127.0.0.1:1512 \
  --tls-cert /etc/dc24h/tls/fullchain.pem \
  --tls-key /etc/dc24h/tls/privkey.pem
```

Use `--language pl` for Polish help and operator messages; `us` is the default.
Add explicit `--listen` options to enable mixed plaintext/TLS service.

Stop with Ctrl+C or SIGTERM. The key must not be committed to Git.
CMake 3.22+, C++20, OpenSSL and utf8proc development packages are required.

Documentation: [English (US)](doc/us/README.md) | [Polski](doc/pl/README.md) | [Module documentation index](doc/README.md) | [CHANGELOG.md](CHANGELOG.md).

License: [GPL-3.0](LICENSE).

## Configuration

```sh
cp config/dc24h.ini.example config/dc24h.ini
./build/dc24h --config config/dc24h.ini --check-config
./build/dc24h --config config/dc24h.ini --max-connections 512
```

Defaults, then explicit INI, then CLI. No file is loaded automatically. INI paths use its directory; CLI paths use the working directory. Use `--log-level info|warning|error|off` and `--log-file PATH` (or `-` for stderr). See [configuration](doc/us/CONFIGURATION.md) for complete precedence, format, limits and logging constraints.

Connection records are off by default; enable with `--log-connections on` or `[logging] connections=on` at INFO. Records use internal IDs and fixed events without client addresses or ADC payloads. See [logging](doc/us/LOGGING.md) for limits and suppression behavior.

Negotiation defaults: 256 pending logins/hub, 64/IP, 65536 plaintext bytes and 64 decoder results until completed login, 64 initial identity attempts/IP/minute and 128/hub/second. Configure these INI `[security]` options for deployment needs.

Terminal output has a 2-second absolute drain deadline (`[security] close_timeout`).

Login/output defaults: 30 seconds for full login, 10 seconds without output progress, 256 KiB queued wire bytes/client and 16 MiB/hub. The two deadlines are INI settings in `[security]`; byte limits are compiled defaults.

Security defaults: 128 active peers/IP, 256 admissions/IP/minute, 1024 decoder results/s/connection, 512 invalid frames/connection, and 10-second TLS/partial-frame deadlines. Frame bodies remain capped at 16 KiB with 128 parameters. Configure `[security]` or CLI; see [security](doc/us/SECURITY.md) for exact policies and limitations.

MariaDB is disabled by default. Configure `[database]` to enable connection checks before listener startup. Use `--check-database` to connect/ping or `--migrate-database` to explicitly create/verify migration metadata; startup never migrates. Install `mariadb-server` to run disposable integration tests. See [database documentation](doc/us/DATABASE.md) for setup, privileges and limits.

The administrative API is disabled by default. Enable `[api]` with a private Unix socket directory and a private 64-hex-character token file. Authenticated `GET /api/v1/health` and `GET /api/v1/status` are read-only on the hub process. The WebAdmin adapter holds the service token outside the browser. The Apache proxy example is local and allowlisted. Public web authentication and remote administrator access remain separate work. See [API setup and contract](doc/us/API.md).

## WebAdmin

```sh
cd webadmin
npm ci
npm run build
npm run dev
```

Requires Node.js `^20.19.0 || >=22.12.0`. Open the local URL printed by Vite. Without API configuration the panel shows unavailable values. For the optional real C++ connection, use the same service UID and server-only socket/token-file path variables; never paste a service token into the browser. See [WebAdmin US](doc/us/WEBADMIN.md) / [WebAdmin PL](doc/pl/WEBADMIN.md) for setup, Apache2 and optional CMake asset installation. Public browser sessions and remote administrator access remain separate work.

An Apache2 HTTPS template is included at [config/apache2-webadmin-https.conf.example](config/apache2-webadmin-https.conf.example) and installed with the configuration examples. Customize domain/certificate/asset paths before enabling it; default access is local and API routes remain denied. The separate [proxy example](config/apache2-webadmin-https-proxy.conf.example) forwards an allowlisted API to the loopback adapter and does not contain the service token. Setup: [HTTPS US](doc/us/APACHE2_HTTPS.md) / [HTTPS PL](doc/pl/APACHE2_HTTPS.md) and [proxy US](doc/us/APACHE2_PROXY.md) / [proxy PL](doc/pl/APACHE2_PROXY.md). No host site or certificate is activated automatically.

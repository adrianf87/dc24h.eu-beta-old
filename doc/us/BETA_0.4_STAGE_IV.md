# Beta 0.4.13–0.4.16 — Stage IV release-candidate review

This is the development scope for [Issue #223](https://github.com/adrianf87/dc24h.eu-high-starter/issues/223) on **one branch**, `beta-0.4.13-0.4.16-stage4`, with four ordered patch commits and one pull request to `main`. It is a **release candidate, not a release authorization**. Never automatically merge, deploy, or expose the private WebAdmin to the Internet.

| Patch | Deliverable | Evidence boundary |
| --- | --- | --- |
| beta-0.4.13 — Security Testing | Negative WebAuthn assertion and registration tests for Origin, RP ID, UP/UV, challenge/ceremony mismatch, cross-account credentials and replay; denied device modifications and browser enrollment. | Automated fixtures demonstrate defined refusals, **not** a penetration test or independent security review. |
| beta-0.4.14 — Performance | A bounded, explicit opt-in, loopback-only ADC/ADCS, HTTPS and authorized read-only API probe. [Measurement protocol](BETA_0.4_STAGE_IV_PERFORMANCE.md). | Actual Debian 13 CPU/RAM, throughput, p95/p99, errors and MariaDB measurements: **NOT MEASURED**. |
| beta-0.4.15 — Disaster Recovery | Offline private-state snapshot, checksum/audit verification and restore into a **new** private directory; negative corruption/symlink tests. [Recovery procedure](BETA_0.4_STAGE_IV_RECOVERY.md). | Target MariaDB backup/restore, restart/outage, RPO/RTO and rollback: **NOT MEASURED**. |
| beta-0.4.16 — Final Security Release | Version and release-gate alignment, EN/US documentation, PL operator guide, checks for immutable private boundaries and a reviewed go/no-go checklist. | **Independent code/security review: PENDING**. Full GitHub CI and target validation must finish before approval. |

## Scope and security invariants

The C++20 Direct Connect hub and ADC/ADCS protocol stay unchanged. Authentication, accounts, grants and authorization remain under the C++ service. WebAdmin remains React + TypeScript + Vite with password plus TOTP or password plus passkey; **passkey login is not passwordless**. MariaDB schema **v11** remains unchanged; Stage IV does not introduce migrations. The Node remote gateway is loopback-only, optionally behind the manually configured Apache2 localhost HTTPS vhost. No hub-control writes, public WebAdmin, private key storage in the browser, or production installation are added.

Supported targets to validate: Ubuntu 22.04, 24.04 and 26.04 (CI); Debian 12 and 13 (operator acceptance). Specifically requested target: **Debian 13 Trixie, Intel Xeon D-1521 (8 × 2.7 GHz), 31,997 MiB RAM**, Apache2 and MariaDB. GitHub Ubuntu CI cannot establish performance, TLS trust, unit hardening, resilience or restoration behavior on that host.

## Evidence collection and release gates

1. Pin the candidate commit SHA and the exact pull request. Await the **entire latest-head GitHub Actions run** (C++ Debug/Release on Debian 12/13 and three Ubuntu images, WebAdmin on the same five images, ASan/UBSan and the required aggregate gate). Review any CodeQL/security checks that apply. Do not treat still-running or cancelled checks as passing; after any fix, restart this gate using the **new head SHA**.
2. Verify CMake/CTest, the WebAdmin Node tests, production build, browser integration, dependency audit and negative security cases, including TLS hostname/Origin, CSRF, invalid credentials, replay, private audit corruption and authorization revocation. Archive test names, results and links, not tokens or private state.
3. Have an **independent security reviewer** assess current authentication, device recovery, session expiry/invalidation, MariaDB access, Apache2 TLS/loopback boundary, the rate-limit file and audit persistence. Record any findings and their owners; fixes must return through CI.
4. On a **disposable, isolated** Debian 13 replica matching the named target, have the operator run and record the [performance measurements](BETA_0.4_STAGE_IV_PERFORMANCE.md), then [MariaDB/service recovery and rollback](BETA_0.4_STAGE_IV_RECOVERY.md). Repeat the negative authorization tests. Confirm backup integrity and approved RPO/RTO with a second operator.
5. Record a signed-off decision below. A green PR is a prerequisite, **not** approval for deployment or for exposing a public listener. Keep the PR and issue open until all blocking evidence exists and the project owner authorizes the next step.

### Release-candidate risk register — initial status

| Risk / required evidence | Status | Required owner action |
| --- | --- | --- |
| Target-host performance and capacity | **NOT MEASURED** | Capture isolated workload, p50/p95/p99, errors, CPU, RSS and database observations; agree thresholds. |
| Real MariaDB outage, service restarts and rollback | **NOT MEASURED** | Execute a disposable failure drill and verify restoration, backup consistency and RPO/RTO. |
| Independent security review | **PENDING** | Obtain an independent review and address findings. |
| Debian 12/13 compatibility | **PENDING** | Record exact environment and signed operator evidence. |
| Latest-head complete CI | **PENDING until GitHub reports results** | Save job links and complete all required gates. |
| Public WebAdmin and production rollout | **NOT AUTHORIZED** | A separate written authorization and threat-model update would be required. |

### Manual sign-off record (do not prefill)

- Candidate SHA / PR / required checks and completed times: **PENDING**
- Independent reviewer, review date, severity and remediation: **PENDING**
- Debian 13 test host, operator, configuration and attachments: **PENDING**
- Approved performance thresholds and captured metrics: **NOT MEASURED**
- Verified MariaDB/private-state restore, RPO/RTO and rollback: **NOT MEASURED**
- Remaining risks, second operator and owner decision: **PENDING — NO-GO**

The release gate fails operationally until all blocking evidence is independently accepted. Version `beta-0.4.16` signals the **development code state only**. It is not a production readiness statement.

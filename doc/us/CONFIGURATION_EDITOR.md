# WebAdmin configuration editor — beta-0.1.4

This stage connects the **beta-0.1.3 local maintenance API** to the WebAdmin Configuration page. It does not change the C++ INI writer, MariaDB schema v10, live hub settings or systemd. The editor works only with the separate `dc24h-account-admin` maintenance process on the configured Unix socket. The serving hub must be stopped first.

## Operator procedure

1. Make independent INI/database backups, stop the hub and verify the private INI with `--check-config`. Apply schema migration v10 before running the separate maintenance process.
2. Open the **loopback-only** WebAdmin. Prove an active Administrator or Owner account in **Admin Core**. The short-lived grant, session and CSRF secret remain in page memory, never in browser storage.
3. Open **Configuration → Maintenance configuration editor** and load the saved INI. Available fields: `network_max_connections` (1–65535), `network_idle_timeout` (1–86400 seconds), `logging_level` (`info`, `warning`, `error`, `off`), `general_language` (`us`, `pl`). Saved settings and maintenance-startup values are distinct; neither is a snapshot of a running hub.
4. Edit the fields and choose **Validate and preview changes**. The C++ parser checks the candidate, exact serialized INI limits and opaque HMAC revision without writing. Duplicate settings are refused. The preview shows only changed keys; another edit invalidates it.
5. Confirm the reviewed changes and click **Save configuration**. The atomic backend creates a private one-generation backup. Alternatively, confirm **Restore backup** to restore the previous INI and retain an undo copy. Repeating a restore when the backup already matches the current INI is refused to protect that undo copy. Refresh after restoration.
6. Verify the resulting INI, stop maintenance and restart the hub using the existing controlled operator procedure. The editor cannot control the service.

## Security boundary

The example Apache configuration retains `Require local` and exact host, origin, method, form and path checks. It permits GET/POST `/admin-api/v1/management/configuration` and POST `/admin-api/v1/management/configuration/write` or `/restore` only. The loopback Node adapter checks grant/session/CSRF headers, injects its own process bearer for the Unix socket, validates and redacts every response, and refuses unexpected query/path shapes. C++ rechecks the actor's active role and `configuration.manage` each time. Do not remove the localhost restriction or expose a public remote administrator.

Passwords, tokens, TLS keys, file paths, complete INI contents and arbitrary keys never enter browser JavaScript. The broad `management/authorize` compatibility contract remains unimplemented; this narrower editor uses independently authorized routes.

A `409 stale` clears the loaded revision; read the INI again. A `422` refuses invalid proposals. A network error or `503 outcome_unknown` must **not** cause automatic retry: inspect the INI, `.dc24h.bak`, `.dc24h.undo` and audit first. A single backup generation is not a substitute for operator backups. Every saved change requires a controlled restart.

Unit, adapter, Apache and browser tests cover input validation, redaction, grant/CSRF/origin checks, exact routes, preview, confirmation and both languages. Full C++/WebAdmin CI and CodeQL are required before merge. No live reload or service controller is included.

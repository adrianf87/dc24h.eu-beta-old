# Read-only hub service controller — beta-0.1.5

This stage adds an **independent C++20 process** `dc24h-service-controller`. It does not depend on the ADC/ADCS hub being alive, the maintenance HTTP API or MariaDB. It never starts, stops or restarts a unit. This is not a remotely accessible management API.

## Design and trust boundary

1. A local, specifically authorized operator process opens a Unix stream socket in `/run/dc24h-control/status.sock`. The directory is owned by the controller user, with mode `0750`; the socket is mode `0660` and belongs to the controller's designated primary group `dc24h-admin`. The controller additionally verifies Linux `SO_PEERCRED`: peer UID must match the controller UID, or the peer's **primary GID** must match the controller's primary GID. Supplementary group membership alone does not satisfy the peer check. Never add the serving hub's account or an untrusted process to this group.
2. The entire request is the fixed ASCII byte string `STATUS\n` (including LF), at most 32 bytes. Unknown, additional, partial or action requests are refused. The controller returns one JSON line, with a status schema of 1. No bearer token, path, unit, command, PID or shell string is accepted from the caller. Requests and writes have 2-second socket timeouts.
3. Only `/usr/bin/systemctl --system --no-pager show --property=LoadState,ActiveState,SubState,Result,MainPID dc24h.service` is executed, through `fork`/`execve` without a shell, with a fixed minimal environment. The command's output is capped at 4096 bytes and a 2-second deadline. Values are restricted to lowercase letters and hyphens and never reflected unfiltered to the client. The response does **not** expose unit file paths, journal entries, environment or credentials.
4. The socket parent is verified with `O_NOFOLLOW`, owner UID and no group/world write access; existing non-socket paths and symlinks are refused. A live controller cannot be displaced by a second instance. The socket is removed on normal SIGTERM/SIGINT shutdown only if its inode still belongs to this instance. The build does not install, enable or start a host service or create a host account.

Example response when systemd is available (actual values vary):

```json
{"schema":1,"available":true,"unit":"dc24h.service","load_state":"loaded","active_state":"inactive","sub_state":"dead","result":"success"}
```

When systemd is not available the response is `{"schema":1,"available":false,"error":"systemd_unavailable"}`. An invalid manager response produces `invalid_systemd_response`. Neither error is a claim that the hub is active or inactive. These outcomes do not invoke the hub.

## Local deployment (manual review required)

- Review [config/dc24h-control.sysusers.example](../../config/dc24h-control.sysusers.example) and [config/dc24h-control.service.example](../../config/dc24h-control.service.example). Provision the dedicated `dc24h-control` user and `dc24h-admin` group through your host's standard account-management process and restrict membership. Do not reuse the hub's ADC user or an internet-facing user.
- Install the built binary only after review, adapt the example's absolute executable path and copy its unit to the appropriate systemd unit directory. The build does **not** activate it. Consider the unit part of the host's security configuration and review changes before `systemctl daemon-reload` / `enable --now`.
- For a local manual check, run `dc24h-service-controller --socket /run/dc24h-control/status.sock` in a separately provisioned restricted service context. An authorized local peer connects to the socket and writes the literal `STATUS\n` request. Test with `dc24h.service` stopped and with `systemd` unavailable. The controller itself must continue responding independently.
- The socket's group permits **status read only**. There is no `hub.manage` bridge, WebAdmin route, role grant translation, action command, privileged D-Bus method or Polkit rule in this release. An authorized local group is not equivalent to the application Owner role. Before beta-0.1.6, design a separate server-side Owner authorization handoff, explicit operation allowlist, time limits, result verification and audit; never treat socket group membership as enough to authorize service actions.

## Tests and limitations

Audit fix: a valid `STATUS\n` can arrive in multiple Unix-stream fragments; the controller now collects them under one 2-second deadline while still rejecting extra or malformed bytes. An existing socket is removed as stale only after an explicit `ECONNREFUSED` probe. Access-denied and other inconclusive failures leave the socket untouched. Regression tests cover both cases.

`service.controller.process` checks status replies with no hub started, invalid action refusals, a duplicate controller, socket cleanup, symlink protection, unsafe parent permissions and release metadata. The live manager's availability is environment-dependent; tests do not modify the host `dc24h.service`. The example unit is not automatically installed or tested on a live production host. This change does not modify ADC/ADCS behavior, the maintenance API, Apache, WebAdmin controls, MariaDB schema v10 or audit storage. It does not activate `hub.manage` in the application permission catalog. Owner-gated Start/Stop/Restart and auditable service actions belong to beta-0.1.6; the WebAdmin controls belong to beta-0.1.7.

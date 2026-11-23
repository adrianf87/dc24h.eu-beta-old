# Self-hosted GitHub runner (Linux x64)

The repository is private. This directory contains **non-secret** operator
documentation for the current GitHub Actions self-hosted runner and the tests
in [`test/`](test/README.md). Nothing here deploys dc24h or opens WebAdmin.

| Field | Value |
| --- | --- |
| Repository | `adrianf87/dc24h.eu-high-starter` |
| Runner name and custom label | `server-747585786` |
| Runner settings ID | [35](https://github.com/adrianf87/dc24h.eu-high-starter/settings/actions/runners/35) |
| Required GitHub labels | `self-hosted`, `Linux`, `X64`, `server-747585786` |
| Host OS | Debian 13 Trixie, x86_64 (operator-provided screenfetch) |
| Service account | Expected `github-runner`; validate before running the manual suite |
| Container engine | Docker; CI job containers were observed starting, full validation pending |
| Privileged host access | Not assumed and **not required by these tests** |
| Reported hardware | AMD EPYC, 16 logical CPU threads at 3.195 GHz; 64,308 MiB RAM (operator-provided screenfetch) |
| Test container allocation | 16 logical CPU threads and 32 GiB RAM; limits checked by test scripts when executed |
| Observed GitHub status on setup | Correct labels; Stage IV job observed running |

Do not place runner registration tokens, SSH keys, database passwords, host
addresses or production data in this directory, in workflow environment
variables or in uploaded test results. Docker access grants significant
authority on the host; limit trusted repository writers and never run
untrusted pull requests on this runner.

## Test isolation and resources

Five official Docker OS images run **one at a time**, never in parallel:

| Environment | Docker image | Logical CPU threads | RAM ceiling |
| --- | --- | ---: | ---: |
| Debian 12 | `debian:12` | 16 (affinity) | 32 GiB |
| Debian 13 | `debian:13` | 16 (affinity) | 32 GiB |
| Ubuntu 22.04 | `ubuntu:22.04` | 16 (affinity) | 32 GiB |
| Ubuntu 24.04 | `ubuntu:24.04` | 16 (affinity) | 32 GiB |
| Ubuntu 26.04 | `ubuntu:26.04` | 16 (affinity) | 32 GiB |

The host launcher selects sixteen distinct logical CPU IDs from `/proc/cpuinfo`
and passes them to Docker with `--cpuset-cpus`. This restricts **which sixteen
schedulable hardware threads** the process may use; it does **not** reserve
exclusive CPU ownership. There is no `--cpus`, CFS quota or CPU-time throttling
configured. Each container must verify a sixteen-thread process affinity, a
32 GiB cgroup memory limit and no CPU-time quota before starting tests.

Each container has its own ephemeral filesystem, private Unix-socket MariaDB,
loopback Apache/HTTPS and ADC/ADCS listeners, plus Node.js 22 and Chromium.
No host ports are published. The Git checkout and Node runtime are mounted
read-only; only a unique results directory under the runner's temporary
directory is writable from the container. No host Docker socket or production
configuration is mounted. Docker is invoked by the normal `github-runner`
account, not via `sudo`.

## Standard CI on the self-hosted runner

The regular [C++/WebAdmin CI](../.github/workflows/build.yml) and
[Stage IV Linux checks](../.github/workflows/stage4-ubuntu-vm-validation.yml)
are routed exclusively to this runner. Matrix jobs run inside official
Debian 12/13 or Ubuntu 22.04/24.04/26.04 **Docker job containers**, with CPU affinity
restricted to logical CPUs `0-15` and a 32 GiB RAM ceiling. This is CPU
affinity, **not** a CPU-time quota or exclusive thread reservation. The runner
manages container cleanup; cached images can remain on disk. Build artifacts,
MariaDB fixtures and browser dependencies remain inside the containers.

The integration-enabled C++ and Stage IV container jobs install the `systemd`
package to provide `systemd-analyze` and `systemd-sysusers`. They validate the
shipped unit directives and isolated sysusers creation, but the two live
`systemd-run` sandbox checks are explicitly **skipped** when there is no
running systemd system manager (as in standard Docker job containers).
Runtime sandbox enforcement still requires a separately authorized test on
an actual systemd host or VM; CI must not mount the host systemd socket.

Regular CI retains its `push`, same-repository `pull_request` and manual
triggers. Each test job is additionally restricted to actor `adrianf87` and
rejects PR heads from forks. The required check remains named
`CI (C++ and WebAdmin)` and will fail when its gated test jobs do not run.
Do not expand these trust gates while the runner account has Docker access
(equivalent to root-level authority). Jobs are scheduled sequentially by the single runner.

## Default-off five-distribution suite

The separate [five-distro workflow](../.github/workflows/self-hosted-debian13-docker.yml)
has **no** push or pull request events. During initial setup, an
explicitly gated one-time marker commit started the first run; its temporary
push trigger was then removed. The retained workflow is manual-only, with
`confirm_run: DISABLED` by default and a strict opt-in value
`RUN-FIVE-DISTROS`. GitHub only exposes workflow dispatch from
the default branch; until this workflow is merged into `main`, the retained
manual trigger is effectively dormant.

The standard C++/WebAdmin and Stage IV workflows independently cover the five
distributions automatically; this manual suite additionally verifies CPU and
memory cgroup contracts and runs its own sequential full-distro harness.
Do not enable a permanent `push` or `pull_request` trigger for the privileged
manual suite. None of these Docker tests are a production deployment,
full disaster-recovery sign-off or independent security review.

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
| Host OS | Linux x64 (exact distribution not yet verified) |
| Service account | Expected `github-runner`; validate before running the manual suite |
| Container engine | Docker; service-account socket access must be validated on this runner |
| Privileged host access | Not assumed and **not required by these tests** |
| Hardware requirement | Eight available logical CPU IDs and at least 8 GiB RAM; host hardware is not yet verified |
| Observed GitHub status on setup | Idle; correct runner labels |

Do not place runner registration tokens, SSH keys, database passwords, host
addresses or production data in this directory, in workflow environment
variables or in uploaded test results. Docker access grants significant
authority on the host; limit trusted repository writers and never run
untrusted pull requests on this runner.

## Test isolation and resources

Five official Docker OS images run **one at a time**, never in parallel:

| Environment | Docker image | Logical CPU threads | RAM ceiling |
| --- | --- | ---: | ---: |
| Debian 12 | `debian:12` | 8 (affinity) | 8 GiB |
| Debian 13 | `debian:13` | 8 (affinity) | 8 GiB |
| Ubuntu 22.04 | `ubuntu:22.04` | 8 (affinity) | 8 GiB |
| Ubuntu 24.04 | `ubuntu:24.04` | 8 (affinity) | 8 GiB |
| Ubuntu 26.04 | `ubuntu:26.04` | 8 (affinity) | 8 GiB |

The host launcher selects eight distinct logical CPU IDs from `/proc/cpuinfo`
and passes them to Docker with `--cpuset-cpus`. This reserves **which eight
schedulable hardware threads** the process may use; it does **not** reserve
exclusive CPU ownership. There is no `--cpus`, CFS quota or CPU-time throttling
configured. Each container must verify an eight-thread process affinity, an
8 GiB cgroup memory limit and no CPU-time quota before starting tests.

Each container has its own ephemeral filesystem, private Unix-socket MariaDB,
loopback Apache/HTTPS and ADC/ADCS listeners, plus Node.js 22 and Chromium.
No host ports are published. The Git checkout and Node runtime are mounted
read-only; only a unique results directory under the runner's temporary
directory is writable from the container. No host Docker socket or production
configuration is mounted. Docker is invoked by the normal `github-runner`
account, not via `sudo`.

## Standard CI on the self-hosted runner

The regular [C++/WebAdmin CI](../.github/workflows/build.yml) and
[Stage IV Ubuntu checks](../.github/workflows/stage4-ubuntu-vm-validation.yml)
are routed exclusively to this runner. Matrix jobs run inside official
Ubuntu 22.04, 24.04 or 26.04 **Docker job containers**, with CPU affinity
restricted to logical CPUs `0-7` and an 8 GiB RAM ceiling. This is CPU
affinity, **not** a CPU-time quota or exclusive thread reservation. The runner
manages container cleanup; cached images can remain on disk. Build artifacts,
MariaDB fixtures and browser dependencies remain inside the containers.

Regular CI retains its `push`, same-repository `pull_request` and manual
triggers. Each test job is additionally restricted to actor `adrianf87` and
rejects PR heads from forks. The required check remains named
`CI (C++ and WebAdmin)` and will fail when its gated test jobs do not run.
Do not expand these trust gates while the runner account has passwordless
Docker access and sudo. Jobs are scheduled sequentially by the single runner.

## Default-off five-distribution suite

The separate [five-distro workflow](../.github/workflows/self-hosted-debian13-docker.yml)
has **no** push or pull request events. During initial setup, an
explicitly gated one-time marker commit started the first run; its temporary
push trigger was then removed. The retained workflow is manual-only, with
`confirm_run: DISABLED` by default and a strict opt-in value
`RUN-FIVE-DISTROS`. GitHub only exposes workflow dispatch from
the default branch; until this workflow is merged into `main`, the retained
manual trigger is effectively dormant.

Do not enable a permanent `push` or `pull_request` trigger for the privileged
five-distro suite. None of these Docker tests are a production deployment,
full disaster-recovery sign-off or independent security review.

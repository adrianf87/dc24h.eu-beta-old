# Five-distribution self-hosted validation

This folder owns the tests executed on the dedicated Debian 13 GitHub runner:

- `run-matrix.sh`: trusted host launcher; selects **eight distinct hardware
  threads** using Docker `--cpuset-cpus`, sets `--memory 8g --memory-swap 8g`,
  and runs the five OS images sequentially.
- `run-in-container.sh`: validates OS identity, CPU affinity and 8 GiB memory;
  installs distro-native C++/MariaDB/Apache test dependencies; compiles the
  C++20 server; runs 15 isolated Stage IV CTest checks; builds React/TypeScript/
  Vite; runs WebAdmin unit tests, Playwright Chromium E2E and live C++ API.
- `test_workflow_policy.py`: offline regression checks for the default-off
  workflow, isolated runner labels, CPU affinity and memory settings.

This suite tests **actual containers** running Debian 12, Debian 13, Ubuntu
22.04, Ubuntu 24.04 and Ubuntu 26.04; it does not change the Debian 13 host's
installed system packages, services, MariaDB database or Apache configuration.
All network listeners used by the tests remain inside disposable containers.

## Expected output

The matrix fails if fewer than 15 required CTest cases are registered, a
test fails, the container cannot verify exactly eight schedulable threads,
its RAM ceiling is not 8 GiB, or a CPU-time quota exists. Each distro has a
separate `ctest.xml`, `loopback-probes.json`, `ctest-discovery.txt` and a
`result.txt` produced only when every test passes. Artifacts are retained
for seven days, without secrets or raw database backups.

The workflow never runs on PR events. It is normally disabled, and its
manual `confirm_run` input defaults to `DISABLED`. To run again after the
workflow is deliberately merged into `main`, select **Run workflow** in
GitHub Actions and explicitly enter `RUN-FIVE-DISTROS`.

On a failed image pull, installation, build or test, the launcher moves to
the next distro so all five results can be collected; the overall job still
fails. Each Docker invocation has a one-hour deadline and `--rm`, plus a
scoped cleanup trap to prevent test containers remaining active.

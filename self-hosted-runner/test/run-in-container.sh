#!/usr/bin/env bash
# All package installs, compiles, MariaDB and browser tests stay inside Docker.
set -Eeuo pipefail

fail() { printf 'Container test: %s\n' "$*" >&2; exit 1; }
[[ -r /src/CMakeLists.txt && -d /reports ]] || fail 'Expected read-only checkout and report directory.'
source /etc/os-release
case "${DISTRO:-}" in
  debian-12) [[ "$ID" == debian && "$VERSION_ID" == 12 ]] || fail 'Incorrect Debian 12 image.' ;;
  debian-13) [[ "$ID" == debian && "$VERSION_ID" == 13 ]] || fail 'Incorrect Debian 13 image.' ;;
  ubuntu-22.04) [[ "$ID" == ubuntu && "$VERSION_ID" == 22.04 ]] || fail 'Incorrect Ubuntu 22.04 image.' ;;
  ubuntu-24.04) [[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || fail 'Incorrect Ubuntu 24.04 image.' ;;
  ubuntu-26.04) [[ "$ID" == ubuntu && "$VERSION_ID" == 26.04 ]] || fail 'Incorrect Ubuntu 26.04 image.' ;;
  *) fail 'Unexpected Linux distribution.' ;;
esac

[[ "$(nproc)" == 8 ]] || fail 'Container does not have exactly eight schedulable threads.'
limit_bytes=$((8 * 1024 * 1024 * 1024))
if [[ -r /sys/fs/cgroup/memory.max ]]; then
  memory_limit="$(< /sys/fs/cgroup/memory.max)"
  [[ "$memory_limit" == "$limit_bytes" ]] || fail 'The cgroup v2 RAM limit is not 8 GiB.'
  read -r cpu_quota _ < /sys/fs/cgroup/cpu.max
  [[ "$cpu_quota" == max ]] || fail 'A CPU-time quota is active; affinity alone was requested.'
elif [[ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]]; then
  memory_limit="$(< /sys/fs/cgroup/memory/memory.limit_in_bytes)"
  [[ "$memory_limit" == "$limit_bytes" ]] || fail 'The cgroup v1 RAM limit is not 8 GiB.'
  [[ "$(< /sys/fs/cgroup/cpu/cpu.cfs_quota_us)" == -1 ]] || fail 'A CPU-time quota is active.'
else
  fail 'No readable memory cgroup limit; cannot verify the 8 GiB boundary.'
fi
[[ "$(node --version)" == v22.* ]] || fail 'Node.js 22 toolchain not mounted.'
printf 'Verified %s %s: 8 real logical threads, 8 GiB RAM, no CPU-time quota.\n' "$ID" "$VERSION_ID"

export DEBIAN_FRONTEND=noninteractive
apt_options=(-o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15)
timeout --signal=TERM --kill-after=10s 300s apt-get "${apt_options[@]}" update
timeout --signal=TERM --kill-after=10s 1200s apt-get "${apt_options[@]}" install -y --no-install-recommends \
  build-essential cmake python3 libutf8proc-dev libgcrypt20-dev \
  libssl-dev libmariadb-dev openssl ncdc mariadb-server apache2 ca-certificates

mkdir -p /work
cp -a /src/. /work/
cd /work
cmake -S . -B build/SelfHosted -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build build/SelfHosted --parallel 4

# All these CTest cases use disposable loopback listeners, private MariaDB
# sockets, and temporary Apache2 config; never touch the host services.
selected='^(database\.(process|resilience\.process|migrations\.process)|apache2\.(https|https\.proxy|remote\.gateway)|api\.(unit|process)|adcs\.tls_security\.process|beta\.04\.stage4\.(perf\.command|recovery|release|vm\.probe)|remote\.(gateway\.config|pilot\.preflight))$'
ctest --test-dir build/SelfHosted -N -R "$selected" | tee /reports/ctest-discovery.txt
test_count="$(grep -c 'Test *#' /reports/ctest-discovery.txt)"
[[ "$test_count" == 15 ]] || fail "Expected 15 operational CTest cases, got $test_count."
DC24H_VM_REPORT_DIR=/reports ctest --test-dir build/SelfHosted \
  --output-on-failure --output-junit /reports/ctest.xml \
  --parallel 2 --timeout 240 -R "$selected"

cd webadmin
npm ci
npm run build
node --import tsx --test --test-concurrency=2 tests/*.test.ts
npx playwright install --with-deps chromium
npm run test:e2e -- --workers=2 --fully-parallel
npm run test:integration -- ../build/SelfHosted/dc24h

printf 'PASS: %s %s, 15 CTest cases, WebAdmin unit/E2E and live API.\n' "$ID" "$VERSION_ID" | tee /reports/result.txt

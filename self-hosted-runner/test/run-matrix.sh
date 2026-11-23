#!/usr/bin/env bash
# Run five disposable distro containers sequentially on the named Debian 13 runner.
set -Eeuo pipefail

fail() { printf 'Self-hosted matrix: %s\n' "$*" >&2; exit 1; }

[[ "${GITHUB_ACTIONS:-}" == true ]] || fail 'Only GitHub Actions may invoke the host matrix.'
[[ "${RUNNER_NAME:-}" == server-759505093 ]] || fail 'Unexpected runner identity.'
[[ "$(id -un)" == github-runner ]] || fail 'Expected the github-runner service account.'
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || fail 'Invalid workflow run ID.'
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || fail 'Invalid workflow attempt.'
[[ -d "${GITHUB_WORKSPACE:-/nonexistent}" ]] || fail 'Checkout workspace missing.'
[[ -d "${RUNNER_TEMP:-/nonexistent}" ]] || fail 'Runner temporary directory missing.'

command -v docker >/dev/null || fail 'Docker is not installed.'
docker info --format '{{.ServerVersion}}' >/dev/null || fail 'Docker daemon is unavailable to github-runner.'
command -v node >/dev/null || fail 'Node 22 must be provisioned by setup-node.'
[[ "$(node --version)" == v22.* ]] || fail 'Expected Node.js 22.'
node_root="$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")"
[[ -r "$node_root/bin/npm" ]] || fail 'Node.js npm runtime missing.'

# Select eight distinct online logical CPU IDs. --cpuset-cpus changes scheduler
# affinity; --cpus/--cpu-quota would only enforce CPU time and are NOT used.
mapfile -t logical_threads < <(awk -F: '/^processor[[:space:]]*:/ {gsub(/[[:space:]]/, "", $2); print $2}' /proc/cpuinfo | head -n 8)
[[ "${#logical_threads[@]}" -eq 8 ]] || fail 'Eight online hardware threads are required.'
[[ "$(printf '%s\n' "${logical_threads[@]}" | sort -un | wc -l)" -eq 8 ]] || fail 'CPU IDs must be distinct.'
cpuset="$(IFS=,; printf '%s' "${logical_threads[*]}")"

report_root="$RUNNER_TEMP/dc24h-container-results/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
mkdir -p -m 0700 "$report_root"
printf 'Using eight host logical CPU IDs: %s; 8 GiB per container; no CPU-time quota.\n' "$cpuset"

declare -a distros=(debian-12 debian-13 ubuntu-22.04 ubuntu-24.04 ubuntu-26.04)
declare -a images=(debian:12 debian:13 ubuntu:22.04 ubuntu:24.04 ubuntu:26.04)
failed=0
current_container=''
cleanup() {
  if [[ -n "$current_container" ]]; then
    docker container rm -f "$current_container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for index in "${!distros[@]}"; do
  distro="${distros[$index]}"
  image="${images[$index]}"
  result_dir="$report_root/$distro"
  mkdir -p -m 0755 "$result_dir"
  current_container="dc24h-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${distro//./-}"
  printf '\n=== Isolated %s (%s) ===\n' "$distro" "$image"
  if timeout --signal=TERM --kill-after=30s 3600s docker run --rm --init \
    --name "$current_container" --pull always --platform linux/amd64 \
    --cpuset-cpus "$cpuset" --memory 8g --memory-swap 8g --pids-limit 512 \
    --security-opt no-new-privileges --cap-drop NET_RAW --cap-drop SYS_ADMIN \
    --network bridge \
    --mount "type=bind,src=$GITHUB_WORKSPACE,dst=/src,readonly" \
    --mount "type=bind,src=$result_dir,dst=/reports" \
    --mount "type=bind,src=$node_root,dst=/opt/node,readonly" \
    --env "DISTRO=$distro" --env CI=true \
    --env PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    "$image" bash /src/self-hosted-runner/test/run-in-container.sh; then
    printf '%s: PASS\n' "$distro"
  else
    printf '%s: FAIL (see this job log)\n' "$distro" >&2
    failed=$((failed + 1))
  fi
  cleanup
  current_container=''
done

printf '\nFinished five distributions: %d passed, %d failed.\n' "$((5 - failed))" "$failed"
[[ "$failed" -eq 0 ]] || exit 1

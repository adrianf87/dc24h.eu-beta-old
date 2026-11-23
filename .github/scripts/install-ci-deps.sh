#!/usr/bin/env bash
set -Eeuo pipefail

if (( $# == 0 )); then
  echo "Usage: $0 PACKAGE..." >&2
  exit 2
fi

run_as_root=()
if (( EUID != 0 )); then
  command -v sudo >/dev/null || { echo "sudo is required for non-root CI jobs" >&2; exit 1; }
  run_as_root=(sudo)
fi

# Hosted runners can expose an unreachable regional EC2 mirror via apt-mirrors.txt.
# Keep the normal Ubuntu suites and signing policy, but use the canonical mirror.
for sources in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
  if [[ -f "$sources" ]]; then
    "${run_as_root[@]}" sed -i -E \
      's#https?://[[:alnum:].-]+\.ec2\.archive\.ubuntu\.com/ubuntu/?#http://archive.ubuntu.com/ubuntu/#g' \
      "$sources"
  fi
done

apt_network_options=(
  -o Acquire::Retries=1
  -o Acquire::http::Timeout=15
  -o Acquire::https::Timeout=15
)

# Fail with an actionable timeout instead of consuming the whole CI job slot.
"${run_as_root[@]}" timeout --signal=TERM --kill-after=10s 300s \
  apt-get "${apt_network_options[@]}" update

"${run_as_root[@]}" env DEBIAN_FRONTEND=noninteractive \
  timeout --signal=TERM --kill-after=10s 1200s \
  apt-get "${apt_network_options[@]}" install -y --no-install-recommends "$@"

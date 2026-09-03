#!/bin/sh
set -eu

image="${1:-}"
output_dir="${2:-/opt/codex-gateway-backups}"

if [ -z "${image}" ]; then
  echo "usage: backup-docker-image.sh <image> [output-dir]" >&2
  exit 1
fi

mkdir -p "${output_dir}"
safe_name="$(printf '%s' "${image}" | tr '/:' '__')"
stamp="$(date +%Y%m%d-%H%M%S)"
output="${output_dir}/${safe_name}-${stamp}.tar.gz"

docker image inspect "${image}" >/dev/null
docker save "${image}" | gzip -c > "${output}"
echo "${output}"

#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$script_dir/docker-compose.yml"
project_name="${MYSQL_COMPOSE_PROJECT_NAME:-codex-gateway-mysql-tests-$$}"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose -p "$project_name" -f "$compose_file" logs --no-color mysql >&2 || true
  fi
  docker compose -p "$project_name" -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
}

if [ "$#" -eq 0 ]; then
  printf 'Usage: %s <test command>\n' "$0" >&2
  exit 64
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker CLI is required for MySQL integration tests\n' >&2
  exit 127
fi

trap cleanup EXIT
docker compose -p "$project_name" -f "$compose_file" up -d mysql

for _ in $(seq 1 60); do
  if docker compose -p "$project_name" -f "$compose_file" exec -T mysql \
    mysqladmin ping -h localhost -uroot -pcodex-gateway-mysql-test-root-password --silent; then
    break
  fi
  sleep 1
done

docker compose -p "$project_name" -f "$compose_file" exec -T mysql \
  mysqladmin ping -h localhost -uroot -pcodex-gateway-mysql-test-root-password --silent >/dev/null

docker compose -p "$project_name" -f "$compose_file" run --rm -T test-runner \
  bash -lc 'corepack enable >/dev/null && pnpm install --frozen-lockfile --ignore-scripts >/dev/null && pnpm exec nuxi prepare >/dev/null && exec "$@"' \
  -- "$@"

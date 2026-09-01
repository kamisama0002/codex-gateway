#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/../.." && pwd)"
compose_file="$script_dir/docker-compose.yml"
project_name="${E2E_COMPOSE_PROJECT_NAME:-codex-gateway-e2e}"
agent_image="codex-agent-runtime:0.151.0"
e2e_managed_label="com.codex-gateway.e2e-managed=$project_name"

if [ "${1:-}" = "--turn" ]; then
  export E2E_CODEX_TURN=1
  shift
fi

if [ "${1:-}" = "--" ]; then
  shift
fi

export E2E_UID="${E2E_UID:-12345}"
export E2E_GID="${E2E_GID:-12345}"
export E2E_CODEX_HOME="${E2E_CODEX_HOME:-$HOME/.codex}"
if [ -z "${E2E_CODEX_PROVIDER_KEY_FILE:-}" ]; then
  if [ -r /etc/codex/providers/kimi-k3.key ]; then
    export E2E_CODEX_PROVIDER_KEY_FILE=/etc/codex/providers/kimi-k3.key
  else
    export E2E_CODEX_PROVIDER_KEY_FILE=/dev/null
  fi
fi
export E2E_AGENT_NETWORK_NAME="${E2E_AGENT_NETWORK_NAME:-$project_name-agent-runtime}"
export E2E_RUNTIME_MANAGER_NETWORK_NAME="${E2E_RUNTIME_MANAGER_NETWORK_NAME:-$project_name-runtime-manager}"
export E2E_MANAGED_LABEL_VALUE="$project_name"
export RUNTIME_MANAGER_SHARED_SECRET="${RUNTIME_MANAGER_SHARED_SECRET:-codex-gateway-e2e-runtime-manager-secret}"

cleanup_managed_resources() {
  local container_ids=()
  local volume_names=()
  while IFS= read -r container_id; do
    [ -n "$container_id" ] && container_ids+=("$container_id")
  done < <(docker ps --all --quiet --filter "label=$e2e_managed_label" 2>/dev/null || true)
  if [ "${#container_ids[@]}" -gt 0 ]; then
    docker rm --force "${container_ids[@]}" >/dev/null 2>&1 || true
  fi
  while IFS= read -r volume_name; do
    [ -n "$volume_name" ] && volume_names+=("$volume_name")
  done < <(docker volume ls --quiet --filter "label=$e2e_managed_label" 2>/dev/null || true)
  if [ "${#volume_names[@]}" -gt 0 ]; then
    docker volume rm "${volume_names[@]}" >/dev/null 2>&1 || true
  fi
}

assert_equal() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" != "$expected" ]; then
    printf 'E2E assertion failed: %s (expected %s, got %s)\n' \
      "$description" "$expected" "$actual" >&2
    return 1
  fi
}

assert_no_port_bindings() {
  local description="$1"
  local container_id="$2"
  local bindings
  bindings="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$container_id")"
  if [ "$bindings" != "null" ] && [ "$bindings" != "{}" ]; then
    printf 'E2E assertion failed: %s publishes host ports\n' "$description" >&2
    return 1
  fi
}

wait_for_agent_health() {
  local container_id="$1"
  local health=""
  for _ in $(seq 1 60); do
    health="$(docker inspect --format '{{.State.Health.Status}}' "$container_id")"
    if [ "$health" = "healthy" ]; then
      return 0
    fi
    if [ "$health" = "unhealthy" ]; then
      break
    fi
    sleep 1
  done
  printf 'E2E assertion failed: managed Agent health is %s\n' "$health" >&2
  return 1
}

verify_compose_security_boundary() {
  docker compose -p "$project_name" -f "$compose_file" config --format json | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const config = JSON.parse(input);
  const services = config.services ?? {};
  const socket = "/var/run/docker.sock";
  const socketOwners = Object.entries(services)
    .filter(([, service]) => (service.volumes ?? []).some((mount) => mount.source === socket || mount.target === socket))
    .map(([name]) => name);
  if (JSON.stringify(socketOwners) !== JSON.stringify(["agent-runtime-manager"])) {
    throw new Error(`Only Runtime Manager may mount the Docker socket; found ${socketOwners.join(",")}`);
  }
  const nonceVolumeOwners = Object.entries(services)
    .filter(([, service]) => (service.volumes ?? []).some((mount) => mount.target === "/data"))
    .map(([name]) => name);
  if (JSON.stringify(nonceVolumeOwners) !== JSON.stringify(["agent-runtime-manager"])) {
    throw new Error(`Only Runtime Manager may mount its nonce volume; found ${nonceVolumeOwners.join(",")}`);
  }
  for (const name of ["agent-runtime-manager", "gateway-under-test", "test-runner"]) {
    if ((services[name]?.ports ?? []).length !== 0) throw new Error(`${name} publishes a host port`);
  }
  for (const name of ["runtime-manager", "agent-runtime"]) {
    if (config.networks?.[name]?.internal !== true) throw new Error(`${name} must be internal`);
  }
});
'
}

verify_agent_image() {
  assert_equal "Agent image user" "10001:10001" \
    "$(docker image inspect --format '{{.Config.User}}' "$agent_image")"
  assert_equal "Agent image Codex version label" "0.151.0" \
    "$(docker image inspect --format '{{index .Config.Labels "com.qiancheng.codex.version"}}' "$agent_image")"
  assert_equal "Agent image exposed port" "4500/tcp" \
    "$(docker image inspect --format '{{range $port, $_ := .Config.ExposedPorts}}{{$port}}{{end}}' "$agent_image")"
  assert_equal "Agent image entrypoint" \
    '["/usr/bin/tini","--","/usr/local/bin/agent-runtime-entrypoint"]' \
    "$(docker image inspect --format '{{json .Config.Entrypoint}}' "$agent_image")"
  assert_equal "Agent image healthcheck" \
    '["CMD","node","/usr/local/lib/agent-runtime-healthcheck.mjs"]' \
    "$(docker image inspect --format '{{json .Config.Healthcheck.Test}}' "$agent_image")"
}

verify_managed_runtime_docker_state() {
  local manager_id gateway_id
  local agent_ids=()
  local volume_names=()
  manager_id="$(docker compose -p "$project_name" -f "$compose_file" ps --quiet agent-runtime-manager)"
  gateway_id="$(docker compose -p "$project_name" -f "$compose_file" ps --quiet gateway-under-test)"
  assert_no_port_bindings "Runtime Manager" "$manager_id"
  assert_no_port_bindings "Gateway" "$gateway_id"
  assert_equal "Runtime Manager Docker socket mount count" "1" \
    "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/run/docker.sock"}}1{{end}}{{end}}' "$manager_id")"
  assert_equal "Gateway Docker socket mount count" "" \
    "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/run/docker.sock"}}1{{end}}{{end}}' "$gateway_id")"

  while IFS= read -r container_id; do
    [ -n "$container_id" ] && agent_ids+=("$container_id")
  done < <(docker ps --all --quiet --filter "label=$e2e_managed_label")
  assert_equal "managed Agent container count" "2" "${#agent_ids[@]}"
  for container_id in "${agent_ids[@]}"; do
    wait_for_agent_health "$container_id"
    assert_no_port_bindings "managed Agent" "$container_id"
    assert_equal "managed Agent image" "$agent_image" \
      "$(docker inspect --format '{{.Config.Image}}' "$container_id")"
    assert_equal "managed Agent user" "10001:10001" \
      "$(docker inspect --format '{{.Config.User}}' "$container_id")"
    assert_equal "managed Agent read-only root" "true" \
      "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_id")"
    assert_equal "managed Agent privileged mode" "false" \
      "$(docker inspect --format '{{.HostConfig.Privileged}}' "$container_id")"
    assert_equal "managed Agent dropped capabilities" '["ALL"]' \
      "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container_id")"
    assert_equal "managed Agent no-new-privileges" '["no-new-privileges:true"]' \
      "$(docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$container_id")"
    assert_equal "managed Agent PID limit" "256" \
      "$(docker inspect --format '{{.HostConfig.PidsLimit}}' "$container_id")"
    assert_equal "managed Agent memory limit" "2147483648" \
      "$(docker inspect --format '{{.HostConfig.Memory}}' "$container_id")"
    assert_equal "managed Agent CPU limit" "2000000000" \
      "$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$container_id")"
    assert_equal "managed Agent tmpfs policy" \
      '{"/tmp":"rw,nosuid,nodev,noexec,size=64m"}' \
      "$(docker inspect --format '{{json .HostConfig.Tmpfs}}' "$container_id")"
    assert_equal "managed Agent private network" "$E2E_AGENT_NETWORK_NAME" \
      "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container_id")"
    assert_equal "managed Agent image version" "0.151.0" \
      "$(docker inspect --format '{{index .Config.Labels "com.codex-gateway.image-version"}}' "$container_id")"
    assert_equal "managed Agent named volume mount markers" "11" \
      "$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}1{{end}}{{end}}' "$container_id")"
  done

  while IFS= read -r volume_name; do
    [ -n "$volume_name" ] && volume_names+=("$volume_name")
  done < <(docker volume ls --quiet --filter "label=$e2e_managed_label")
  assert_equal "managed Agent volume count" "4" "${#volume_names[@]}"
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose -p "$project_name" -f "$compose_file" logs --no-color \
      agent-runtime-manager gateway-under-test ssh-target >&2 || true
  fi
  cleanup_managed_resources
  docker compose -p "$project_name" -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is required for containerized E2E" >&2
  exit 127
fi
trap cleanup EXIT

cleanup_managed_resources
verify_compose_security_boundary
docker compose -p "$project_name" -f "$compose_file" build \
  agent-runtime-image agent-runtime-manager build-runner ssh-target ssh-target-legacy-node ssh-target-legacy-codex
verify_agent_image
# Build, application server, and browser runner use separate 2 GiB cgroups. Sharing only the
# gateway network namespace preserves the production-like nip.io subdomain routing used by browser
# preview tests without coupling process memory.
docker compose -p "$project_name" -f "$compose_file" run --rm build-runner \
  bash -lc 'rm -rf .output .nuxt .data-e2e/* /e2e-output/* && pnpm exec nuxt build --extends ./tests/e2e/nuxt-layer && cp -a .output/. /e2e-output/ && node scripts/create-user.mjs "$E2E_GATEWAY_USERNAME" "$E2E_GATEWAY_PASSWORD" --role admin && node scripts/create-user.mjs runtime-a managed-runtime-e2e-password --role user && node scripts/create-user.mjs runtime-b managed-runtime-e2e-password --role user'
docker compose -p "$project_name" -f "$compose_file" up -d --wait \
  agent-runtime-manager gateway-under-test browser-preview-ingress
docker compose -p "$project_name" -f "$compose_file" run --rm test-runner \
  bash -lc 'if [ -e /var/run/docker.sock ]; then echo "test-runner must not receive the Docker socket" >&2; exit 1; fi; exec pnpm exec playwright test "$@"' \
  e2e "$@"
verify_managed_runtime_docker_state

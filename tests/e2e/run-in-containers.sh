#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/../.." && pwd)"
compose_file="$script_dir/docker-compose.yml"
project_name="${E2E_COMPOSE_PROJECT_NAME:-codex-gateway-e2e}-$$"
if [[ ! "$project_name" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  printf 'E2E Compose project name is invalid: %s\n' "$project_name" >&2
  exit 64
fi
database_name="codex_gateway_e2e_$$"
resource_expectations_filename="managed-runtime-resource-expectations-$project_name.json"
resource_expectations_file="$project_dir/test-results/$resource_expectations_filename"
container_resource_expectations_file="/workspace/codex-gateway/test-results/$resource_expectations_filename"
agent_image_is_generated=0
runtime_manager_image_is_generated=0
runner_image_is_generated=0
if [ -n "${E2E_AGENT_IMAGE:-}" ]; then
  agent_image="$E2E_AGENT_IMAGE"
else
  agent_image="codex-agent-runtime:$project_name"
  agent_image_is_generated=1
fi
if [ -n "${E2E_RUNTIME_MANAGER_IMAGE:-}" ]; then
  runtime_manager_image="$E2E_RUNTIME_MANAGER_IMAGE"
else
  runtime_manager_image="codex-runtime-manager-e2e:$project_name"
  runtime_manager_image_is_generated=1
fi
if [ -n "${E2E_RUNNER_IMAGE:-}" ]; then
  runner_image="$E2E_RUNNER_IMAGE"
else
  runner_image="codex-gateway-e2e-runner:$project_name"
  runner_image_is_generated=1
fi
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
export E2E_GATEWAY_USERNAME="${E2E_GATEWAY_USERNAME:-e2e}"
export E2E_GATEWAY_PASSWORD="${E2E_GATEWAY_PASSWORD:-codex-gateway-e2e-password}"
export E2E_MYSQL_DATABASE="$database_name"
export E2E_CODEX_HOME="${E2E_CODEX_HOME:-$HOME/.codex}"
if [ -z "${E2E_CODEX_PROVIDER_KEY_FILE:-}" ]; then
  if [ -r /etc/codex/providers/kimi-k3.key ]; then
    export E2E_CODEX_PROVIDER_KEY_FILE=/etc/codex/providers/kimi-k3.key
  else
    export E2E_CODEX_PROVIDER_KEY_FILE=/dev/null
  fi
fi
export E2E_AGENT_NETWORK_NAME="${E2E_AGENT_NETWORK_NAME:-$project_name-agent-runtime}"
export E2E_AGENT_B_NETWORK_NAME="${E2E_AGENT_B_NETWORK_NAME:-$project_name-agent-runtime-b}"
export E2E_AGENT_EGRESS_NETWORK_NAME="${E2E_AGENT_EGRESS_NETWORK_NAME:-$project_name-agent-egress}"
export E2E_AGENT_IMAGE="$agent_image"
export E2E_RUNTIME_MANAGER_NETWORK_NAME="${E2E_RUNTIME_MANAGER_NETWORK_NAME:-$project_name-runtime-manager}"
export E2E_RUNTIME_MANAGER_IMAGE="$runtime_manager_image"
export E2E_RUNNER_IMAGE="$runner_image"
export E2E_MANAGED_RUNTIME_RESOURCE_EXPECTATIONS_FILE="$container_resource_expectations_file"
export E2E_MANAGED_LABEL_VALUE="$project_name"
export RUNTIME_MANAGER_SHARED_SECRET="${RUNTIME_MANAGER_SHARED_SECRET:-codex-gateway-e2e-runtime-manager-secret-$project_name}"
export RUNTIME_IDENTITY_SECRET="${RUNTIME_IDENTITY_SECRET:-$RUNTIME_MANAGER_SHARED_SECRET}"
export RUNTIME_MANAGER_B_SHARED_SECRET="${RUNTIME_MANAGER_B_SHARED_SECRET:-codex-gateway-e2e-runtime-manager-b-secret-$project_name}"
if [ "${E2E_PRINT_RESOURCE_EXPECTATIONS_FILE:-0}" = "1" ]; then
  printf '%s\n' "$resource_expectations_file"
fi

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

cleanup_generated_images() {
  local image_names=()
  [ "$agent_image_is_generated" -eq 1 ] && image_names+=("$agent_image")
  [ "$runtime_manager_image_is_generated" -eq 1 ] && image_names+=("$runtime_manager_image")
  [ "$runner_image_is_generated" -eq 1 ] && image_names+=("$runner_image")
  if [ "${#image_names[@]}" -gt 0 ]; then
    docker image rm "${image_names[@]}" >/dev/null 2>&1 || true
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
  if (config.name !== process.env.E2E_EXPECTED_COMPOSE_PROJECT_NAME) {
    throw new Error("E2E Compose project is not the exact generated project");
  }
  const mysql = services.mysql;
  if (mysql === undefined) throw new Error("E2E MySQL service is missing");
  if ((mysql.ports ?? []).length !== 0) throw new Error("E2E MySQL publishes a host port");
  if (mysql.healthcheck === undefined) throw new Error("E2E MySQL healthcheck is missing");
  if (!(mysql.volumes ?? []).some((mount) => mount.target === "/var/lib/mysql")) {
    throw new Error("E2E MySQL persistent data mount is missing");
  }
  for (const name of ["agent-runtime-manager", "agent-runtime-manager-b"]) {
    if (services[name]?.image !== process.env.E2E_RUNTIME_MANAGER_IMAGE) {
      throw new Error(`${name} must use the exact generated E2E tag`);
    }
    const aliases = JSON.parse(services[name]?.environment?.RUNTIME_MANAGER_IMAGE_ALIASES ?? "{}");
    if (aliases.stable?.image !== process.env.E2E_AGENT_IMAGE) {
      throw new Error(`${name} must provision the exact generated Agent image tag`);
    }
  }
  for (const name of ["build-runner", "gateway-under-test", "test-runner"]) {
    if (services[name]?.image !== process.env.E2E_RUNNER_IMAGE) {
      throw new Error(`${name} must use the exact generated E2E runner tag`);
    }
  }
  if (services["test-runner"]?.environment?.E2E_MANAGED_RUNTIME_RESOURCE_EXPECTATIONS_FILE !== process.env.E2E_MANAGED_RUNTIME_RESOURCE_EXPECTATIONS_FILE) {
    throw new Error("test-runner must use the exact per-project Runtime expectation artifact");
  }
  for (const name of ["build-runner", "gateway-under-test", "test-runner"]) {
    const databaseUrl = new URL(services[name]?.environment?.DATABASE_URL ?? "");
    if (databaseUrl.protocol !== "mysql:" || databaseUrl.hostname !== "mysql") {
      throw new Error(`${name} must use the E2E MySQL service`);
    }
    if (databaseUrl.pathname !== `/${process.env.E2E_MYSQL_DATABASE ?? ""}`) {
      throw new Error(`${name} must use the unique E2E MySQL database`);
    }
  }
  for (const name of ["build-runner", "test-runner"]) {
    for (const key of ["E2E_GATEWAY_USERNAME", "E2E_GATEWAY_PASSWORD"]) {
      if (services[name]?.environment?.[key] !== process.env[key]) {
        throw new Error(`${name} must receive ${key}`);
      }
    }
  }
  for (const name of ["agent-runtime-manager", "gateway-under-test", "test-runner"]) {
    if (services[name]?.environment?.RUNTIME_MANAGER_SHARED_SECRET !== process.env.RUNTIME_MANAGER_SHARED_SECRET) {
      throw new Error(`${name} must receive the isolated Runtime Manager secret`);
    }
  }
  for (const name of ["gateway-under-test", "test-runner"]) {
    if (services[name]?.environment?.RUNTIME_IDENTITY_SECRET !== process.env.RUNTIME_IDENTITY_SECRET) {
      throw new Error(`${name} must receive the independent Runtime identity secret`);
    }
  }
  if (services["agent-runtime-manager-b"]?.environment?.RUNTIME_MANAGER_SHARED_SECRET !== process.env.RUNTIME_MANAGER_B_SHARED_SECRET) {
    throw new Error("agent-runtime-manager-b must receive the isolated node B secret");
  }
  const socket = "/var/run/docker.sock";
  const socketOwners = Object.entries(services)
    .filter(([, service]) => (service.volumes ?? []).some((mount) => mount.source === socket || mount.target === socket))
    .map(([name]) => name);
  if (JSON.stringify(socketOwners) !== JSON.stringify(["agent-runtime-manager", "agent-runtime-manager-b"])) {
    throw new Error(`Only Runtime Managers may mount the Docker socket; found ${socketOwners.join(",")}`);
  }
  const nonceVolumeOwners = Object.entries(services)
    .filter(([, service]) => (service.volumes ?? []).some((mount) => mount.target === "/data"))
    .map(([name]) => name);
  if (JSON.stringify(nonceVolumeOwners) !== JSON.stringify(["agent-runtime-manager", "agent-runtime-manager-b"])) {
    throw new Error(`Only Runtime Managers may mount nonce volumes; found ${nonceVolumeOwners.join(",")}`);
  }
  for (const name of [
    "agent-runtime-manager",
    "agent-runtime-manager-b",
    "gateway-under-test",
    "search-mcp",
    "searxng",
    "test-business-mcp",
    "test-runner",
  ]) {
    if ((services[name]?.ports ?? []).length !== 0) throw new Error(`${name} publishes a host port`);
  }
  for (const name of ["runtime-manager", "agent-runtime", "agent-runtime-b"]) {
    if (config.networks?.[name]?.internal !== true) throw new Error(`${name} must be internal`);
  }
  if (config.networks?.["agent-egress"]?.internal === true) {
    throw new Error("agent-egress must provide outbound connectivity");
  }
  if (config.networks?.["search-backend"]?.internal !== true) {
    throw new Error("search-backend must be internal");
  }
});
'
}

verify_production_database_modes() {
  env \
    CODEX_GATEWAY_CONFIG_SECRET=compose-config-test-secret \
    MYSQL_DATABASE=codex_gateway \
    MYSQL_PASSWORD=compose-config-app-password \
    MYSQL_ROOT_PASSWORD=compose-config-root-password \
    MYSQL_USER=codex_gateway \
    RUNTIME_MANAGER_IMAGE_ALIASES='{"stable":{"image":"codex-agent-runtime:0.151.0","imageVersion":"0.151.0"}}' \
    RUNTIME_MANAGER_SHARED_SECRET=compose-config-runtime-secret \
    SEARXNG_IMAGE='searxng/searxng@sha256:55e1fa15a63ff04e79e213e6aa2837549877b0c6d60757cdb633ae9111cb5fea' \
    SEARXNG_SECRET=compose-config-search-secret \
    docker compose -f "$project_dir/docker-compose.yml" config --format json | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const config = JSON.parse(input);
  const services = config.services ?? {};
  const mysql = services.mysql;
  const migration = services["database-migrate"];
  const gateway = services["codex-gateway"];
  if (mysql === undefined) throw new Error("Production MySQL service is missing");
  if ((mysql.ports ?? []).length !== 0) throw new Error("Production MySQL publishes a host port");
  if (mysql.healthcheck === undefined) throw new Error("Production MySQL healthcheck is missing");
  if (!(mysql.volumes ?? []).some((mount) => mount.target === "/var/lib/mysql")) {
    throw new Error("Production MySQL persistent data mount is missing");
  }
  if (config.networks?.["gateway-database"]?.internal !== true) {
    throw new Error("Bundled MySQL network must be internal");
  }
  if (migration === undefined) throw new Error("Production database migration service is missing");
  if (migration.depends_on?.mysql?.condition !== "service_healthy") {
    throw new Error("Database migration must wait for healthy MySQL");
  }
  if (gateway?.depends_on?.["database-migrate"]?.condition !== "service_completed_successfully") {
    throw new Error("Gateway must wait for successful database migration");
  }
  if (migration.image !== gateway.image) {
    throw new Error("Database migration and Gateway must use the same image");
  }
  for (const [name, service] of [["database-migrate", migration], ["codex-gateway", gateway]]) {
    const databaseUrl = new URL(service?.environment?.DATABASE_URL ?? "");
    if (databaseUrl.protocol !== "mysql:" || databaseUrl.hostname !== "mysql") {
      throw new Error(`${name} must use bundled MySQL in self-contained mode`);
    }
    if ((service?.volumes ?? []).some((mount) => mount.target === "/data")) {
      throw new Error(`${name} must not mount the retired SQLite data path`);
    }
  }
});
'

  env \
    CODEX_GATEWAY_CONFIG_SECRET=compose-config-test-secret \
    DATABASE_URL=mysql://external-user:external-password@database.internal:3306/codex_gateway \
    MYSQL_TLS_CA_FILE=/run/secrets/mysql-ca.pem \
    MYSQL_TLS_MODE=verify-identity \
    RUNTIME_MANAGER_IMAGE_ALIASES='{"stable":{"image":"codex-agent-runtime:0.151.0","imageVersion":"0.151.0"}}' \
    RUNTIME_MANAGER_SHARED_SECRET=compose-config-runtime-secret \
    SEARXNG_IMAGE='searxng/searxng@sha256:55e1fa15a63ff04e79e213e6aa2837549877b0c6d60757cdb633ae9111cb5fea' \
    SEARXNG_SECRET=compose-config-search-secret \
    docker compose \
      -f "$project_dir/docker-compose.yml" \
      -f "$project_dir/docker-compose.external-db.yml" \
      config --format json | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const config = JSON.parse(input);
  const services = config.services ?? {};
  const manager = services["agent-runtime-manager"];
  const migration = services["database-migrate"];
  const gateway = services["codex-gateway"];
  if (services.mysql !== undefined) throw new Error("External database mode must omit bundled MySQL");
  if (manager === undefined) throw new Error("External database mode must include Runtime Manager");
  if (migration === undefined) throw new Error("External database mode must include migration");
  if (gateway === undefined) throw new Error("External database mode must include Gateway");
  if (migration?.depends_on?.mysql !== undefined) {
    throw new Error("External database migration must not depend on bundled MySQL");
  }
  if (gateway?.depends_on?.["database-migrate"]?.condition !== "service_completed_successfully") {
    throw new Error("External database Gateway must still wait for migration");
  }
  for (const [name, service] of [["database-migrate", migration], ["codex-gateway", gateway]]) {
    const databaseUrl = new URL(service?.environment?.DATABASE_URL ?? "");
    if (databaseUrl.hostname !== "database.internal") {
      throw new Error(`${name} must use the supplied external DATABASE_URL`);
    }
    if (service?.environment?.MYSQL_TLS_MODE !== "verify-identity") {
      throw new Error(`${name} must use the supplied external MYSQL_TLS_MODE`);
    }
    if (service?.environment?.MYSQL_TLS_CA_FILE !== "/run/secrets/mysql-ca.pem") {
      throw new Error(`${name} must use the supplied external MYSQL_TLS_CA_FILE`);
    }
  }
});
'
}

verify_agent_image() {
  assert_equal "Agent image user" "10001:10001" \
    "$(docker image inspect --format '{{.Config.User}}' "$agent_image")"
  assert_equal "Agent image Codex version label" "0.153.4" \
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

verify_runner_image() {
  assert_equal "Runner pnpm version without network or root HOME" "11.17.0" \
    "$(docker run --rm --network none --env HOME=/home/pwuser --entrypoint pnpm "$runner_image" --version)"
}

verify_managed_runtime_docker_state() {
  local manager_id manager_b_id gateway_id user_hash runtime_id node_id expected_network expected_runtime_count expected_volume_count
  local expected_tuple expected_memory expected_nano_cpus expected_pids_limit
  local expected_resource_lines=""
  local agent_ids=()
  local volume_names=()
  local -A expected_resources=()
  local -A user_hashes=()
  manager_id="$(docker compose -p "$project_name" -f "$compose_file" ps --quiet agent-runtime-manager)"
  manager_b_id="$(docker compose -p "$project_name" -f "$compose_file" ps --quiet agent-runtime-manager-b)"
  gateway_id="$(docker compose -p "$project_name" -f "$compose_file" ps --quiet gateway-under-test)"
  assert_no_port_bindings "Runtime Manager" "$manager_id"
  assert_no_port_bindings "Runtime Manager B" "$manager_b_id"
  assert_no_port_bindings "Gateway" "$gateway_id"
  assert_equal "Runtime Manager Docker socket mount count" "1" \
    "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/run/docker.sock"}}1{{end}}{{end}}' "$manager_id")"
  assert_equal "Runtime Manager B Docker socket mount count" "1" \
    "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/run/docker.sock"}}1{{end}}{{end}}' "$manager_b_id")"
  assert_equal "Gateway Docker socket mount count" "" \
    "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/run/docker.sock"}}1{{end}}{{end}}' "$gateway_id")"

  expected_runtime_count="$(
    docker compose -p "$project_name" -f "$compose_file" exec -T mysql \
      sh -eu -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --batch --skip-column-names --user="$MYSQL_USER" "$MYSQL_DATABASE" --execute="SELECT COUNT(*) FROM user_agent_runtimes"'
  )"
  case "$expected_runtime_count" in
    "" | *[!0-9]*)
      printf 'E2E assertion failed: MySQL runtime count is not a non-negative integer\n' >&2
      return 1
      ;;
  esac
  expected_volume_count=$((expected_runtime_count * 2))

  if [ -f "$resource_expectations_file" ]; then
    expected_resource_lines="$(
      node -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid Runtime resource expectation artifact");
for (const [runtimeId, resources] of Object.entries(value)) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runtimeId)) throw new Error("invalid expected Runtime id");
  const keys = Object.keys(resources ?? {}).sort().join(",");
  if (keys !== "memoryBytes,nanoCpus,pidsLimit") throw new Error("invalid expected Runtime resource shape");
  const values = [resources.memoryBytes, resources.nanoCpus, resources.pidsLimit];
  if (!values.every((item) => Number.isSafeInteger(item) && item > 0)) throw new Error("invalid expected Runtime resources");
  process.stdout.write(`${runtimeId}\t${values.join("\t")}\n`);
}
' "$resource_expectations_file"
    )"
    while IFS=$'\t' read -r runtime_id expected_memory expected_nano_cpus expected_pids_limit; do
      [ -z "$runtime_id" ] && continue
      expected_resources["$runtime_id"]="$expected_memory:$expected_nano_cpus:$expected_pids_limit"
    done <<< "$expected_resource_lines"
  fi

  while IFS= read -r container_id; do
    [ -n "$container_id" ] && agent_ids+=("$container_id")
  done < <(docker ps --all --quiet --filter "label=$e2e_managed_label")
  assert_equal "managed Agent container count" "$expected_runtime_count" "${#agent_ids[@]}"
  for container_id in "${agent_ids[@]}"; do
    runtime_id="$(docker inspect --format '{{index .Config.Labels "com.codex-gateway.runtime-id"}}' "$container_id")"
    node_id="$(docker inspect --format '{{index .Config.Labels "com.codex-gateway.runtime-node-id"}}' "$container_id")"
    if [ -z "$runtime_id" ]; then
      printf 'E2E assertion failed: managed Agent is missing its Runtime identity label\n' >&2
      return 1
    fi
    user_hash="$(docker inspect --format '{{index .Config.Labels "com.codex-gateway.user-hash"}}' "$container_id")"
    if [ -z "$user_hash" ]; then
      printf 'E2E assertion failed: managed Agent is missing its user identity label\n' >&2
      return 1
    fi
    user_hashes["$user_hash"]=1
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
    if [ -n "${expected_resources[$runtime_id]+set}" ]; then
      expected_tuple="${expected_resources[$runtime_id]}"
      unset 'expected_resources[$runtime_id]'
    else
      expected_tuple="8589934592:4000000000:1024"
    fi
    IFS=: read -r expected_memory expected_nano_cpus expected_pids_limit <<< "$expected_tuple"
    assert_equal "managed Agent memory limit" "$expected_memory" \
      "$(docker inspect --format '{{.HostConfig.Memory}}' "$container_id")"
    assert_equal "managed Agent CPU limit" "$expected_nano_cpus" \
      "$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$container_id")"
    assert_equal "managed Agent PID limit" "$expected_pids_limit" \
      "$(docker inspect --format '{{.HostConfig.PidsLimit}}' "$container_id")"
    assert_equal "managed Agent tmpfs policy" \
      '{"/dev/shm":"rw,nosuid,nodev,noexec,size=1073741824","/run/codex-secrets":"rw,nosuid,nodev,noexec,size=16777216,mode=0700,uid=10001,gid=10001","/tmp":"rw,nosuid,nodev,size=2147483648"}' \
      "$(docker inspect --format '{{json .HostConfig.Tmpfs}}' "$container_id")"
    expected_network="$E2E_AGENT_NETWORK_NAME"
    [ "$node_id" = "node__b" ] && expected_network="$E2E_AGENT_B_NETWORK_NAME"
    assert_equal "managed Agent private network" "$expected_network" \
      "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container_id")"
    assert_equal "managed Agent private network attachment" "present" \
      "$(docker inspect --format "{{if index .NetworkSettings.Networks \"$expected_network\"}}present{{end}}" "$container_id")"
    assert_equal "managed Agent egress network attachment" "present" \
      "$(docker inspect --format "{{if index .NetworkSettings.Networks \"$E2E_AGENT_EGRESS_NETWORK_NAME\"}}present{{end}}" "$container_id")"
    assert_equal "managed Agent image version" "0.153.4" \
      "$(docker inspect --format '{{index .Config.Labels "com.codex-gateway.image-version"}}' "$container_id")"
    assert_equal "managed Agent named volume mount markers" "11" \
      "$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}1{{end}}{{end}}' "$container_id")"
    secret_fixture="${E2E_RUNTIME_SECRET_FIXTURE:-full-e2e-runtime-secret-fixture}"
    if docker inspect "$container_id" | grep -Fq "$secret_fixture"; then
      printf 'E2E assertion failed: managed Agent inspect leaked the secret fixture\n' >&2
      return 1
    fi
    if docker logs "$container_id" 2>&1 | grep -Fq "$secret_fixture"; then
      printf 'E2E assertion failed: managed Agent logs leaked the secret fixture\n' >&2
      return 1
    fi
  done
  assert_equal "expected policy Runtime count not observed" "0" "${#expected_resources[@]}"
  assert_equal "managed Agent isolated user count" "$expected_runtime_count" "${#user_hashes[@]}"

  while IFS= read -r volume_name; do
    [ -n "$volume_name" ] && volume_names+=("$volume_name")
  done < <(docker volume ls --quiet --filter "label=$e2e_managed_label")
  assert_equal "managed Agent volume count" "$expected_volume_count" "${#volume_names[@]}"
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose -p "$project_name" -f "$compose_file" logs --no-color \
      mysql agent-runtime-manager gateway-under-test model-target search-mcp searxng \
      agent-runtime-manager-b dataops-target \
      test-business-mcp ssh-target >&2 || true
  fi
  docker compose -p "$project_name" -f "$compose_file" stop \
    gateway-under-test agent-runtime-manager agent-runtime-manager-b >/dev/null 2>&1 || true
  cleanup_managed_resources
  docker compose -p "$project_name" -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
  cleanup_generated_images
  rm -f "$resource_expectations_file"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is required for containerized E2E" >&2
  exit 127
fi
trap cleanup EXIT

cleanup_managed_resources
mkdir -p "$project_dir/test-results"
rm -f "$resource_expectations_file"
verify_production_database_modes
export E2E_EXPECTED_COMPOSE_PROJECT_NAME="$project_name"
verify_compose_security_boundary
if [ "${E2E_VERIFY_CONFIG_ONLY:-0}" = "1" ]; then
  exit 0
fi
build_services=(
  agent-runtime-manager
  build-runner
  search-mcp
  ssh-target
  ssh-target-legacy-node
  ssh-target-legacy-codex
  test-business-mcp
)
if [ "${E2E_SKIP_AGENT_IMAGE_BUILD:-0}" != "1" ]; then
  build_services+=(agent-runtime-image)
fi
docker compose -p "$project_name" -f "$compose_file" build "${build_services[@]}"
if [ "${E2E_SKIP_AGENT_IMAGE_VERIFY:-0}" != "1" ]; then
  verify_agent_image
fi
verify_runner_image
# Build, application server, and browser runner use separate 2 GiB cgroups. Sharing only the
# gateway network namespace preserves the production-like nip.io subdomain routing used by browser
# preview tests without coupling process memory.
docker compose -p "$project_name" -f "$compose_file" up -d --wait mysql
docker compose -p "$project_name" -f "$compose_file" run --rm --no-deps build-runner \
  bash -lc 'rm -rf .output .nuxt /e2e-output/* && pnpm exec nuxt build --extends ./tests/e2e/nuxt-layer && cp -a .output/. /e2e-output/ && node scripts/database/migrate.mjs && node scripts/create-user.mjs "$E2E_GATEWAY_USERNAME" "$E2E_GATEWAY_PASSWORD" --role admin && node scripts/create-user.mjs runtime-a managed-runtime-e2e-password --role user && node scripts/create-user.mjs runtime-b managed-runtime-e2e-password --role user && node scripts/create-user.mjs runtime-c managed-runtime-e2e-password --role user && node scripts/create-user.mjs runtime-d managed-runtime-e2e-password --role user'
docker compose -p "$project_name" -f "$compose_file" up -d --wait \
  agent-runtime-manager agent-runtime-manager-b gateway-under-test browser-preview-ingress
docker compose -p "$project_name" -f "$compose_file" exec -T \
  -e E2E_GATEWAY_USERNAME="$E2E_GATEWAY_USERNAME" \
  -e E2E_GATEWAY_PASSWORD="$E2E_GATEWAY_PASSWORD" \
  gateway-under-test \
  node -e '(async () => { const login = await fetch("http://127.0.0.1:3100/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.E2E_GATEWAY_USERNAME, password: process.env.E2E_GATEWAY_PASSWORD }) }); if (!login.ok) throw new Error(`Gateway E2E login failed: ${login.status} ${await login.text()}`); const session = await login.json(); const seed = await fetch("http://127.0.0.1:3100/api/e2e/dataops-integration", { method: "POST", headers: { authorization: `Bearer ${session.token}` } }); if (!seed.ok) throw new Error(`DataOps E2E seed failed: ${seed.status} ${await seed.text()}`); })().catch((error) => { console.error(error); process.exit(1); })'
docker compose -p "$project_name" -f "$compose_file" run --rm test-runner \
  bash -lc 'if [ -e /var/run/docker.sock ]; then echo "test-runner must not receive the Docker socket" >&2; exit 1; fi; exec pnpm exec playwright test "$@"' \
  e2e "$@"
if [ "${E2E_EXPECT_MANAGED_RUNTIME:-1}" = "1" ]; then
  verify_managed_runtime_docker_state
fi

# Runtime Node Routing Rollout

This runbook covers the single-node compatibility release gate for multi-runtime node routing. It keeps the current Gateway and Runtime Manager running on one node, preserves the existing named volumes, and does not require a second production node yet.

Do not pull new images or recreate volumes during this procedure. Reuse the images and volumes already present on the host unless you are explicitly restoring from the backup artifacts created below.

## Preconditions

- The release image, Runtime Manager image, and MySQL version on the host are already present locally.
- `CODEX_GATEWAY_CONFIG_SECRET` is available from the secret store.
- The old Runtime Manager shared secret is known as `OLD_RUNTIME_MANAGER_SHARED_SECRET` for this rollout.
- `RUNTIME_IDENTITY_SECRET` must be set to the same value as `OLD_RUNTIME_MANAGER_SHARED_SECRET` for the first rollout.
- `RUNTIME_MANAGER_DEFAULT_NODE_ID` is `node__default`.
- External MySQL is reachable and the operator has a secret-backed client option file for it.
- The operator can access the existing `runtime-manager-data` and `capability-data` named volumes.
- `BACKUP_HELPER_IMAGE` names an image already present locally that contains `tar`; verify it with
  `docker image inspect` before the maintenance window.

## 1. Take a frozen backup

Disable shell tracing before touching credentials. Keep all secret values in environment variables or secret files, not on the command line.

```bash
set +x
umask 077
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR=/var/backups/codex-gateway/runtime-node-routing/$STAMP
install -d -m 0700 "$BACKUP_DIR"
: "${BACKUP_HELPER_IMAGE:?set BACKUP_HELPER_IMAGE to a locally present image containing tar}"
docker image inspect "$BACKUP_HELPER_IMAGE" >/dev/null

mysqldump \
  --defaults-extra-file="$MYSQL_BACKUP_CNF" \
  --single-transaction \
  --quick \
  --hex-blob \
  --routines \
  --triggers \
  --events \
  --source-data=2 \
  --set-gtid-purged=OFF \
  codex_gateway \
  > "$BACKUP_DIR/codex_gateway.sql"

sha256sum "$BACKUP_DIR/codex_gateway.sql" > "$BACKUP_DIR/codex_gateway.sql.sha256"

docker run --rm --pull never \
  -v runtime-manager-data:/from:ro \
  -v "$BACKUP_DIR:/to" \
  "$BACKUP_HELPER_IMAGE" sh -c 'tar -C /from -czf /to/runtime-manager-data.tgz .'

docker run --rm --pull never \
  -v capability-data:/from:ro \
  -v "$BACKUP_DIR:/to" \
  "$BACKUP_HELPER_IMAGE" sh -c 'tar -C /from -czf /to/capability-data.tgz .'
```

Record the backup directory, SHA-256 files, and the local image IDs you started with. If any checksum step fails, stop here.

## 2. Run migration 17

Use the existing compose file and the already-present image. Do not rebuild or pull anything.

```bash
set +x
export CODEX_GATEWAY_CONFIG_SECRET="$CODEX_GATEWAY_CONFIG_SECRET"
export RUNTIME_MANAGER_SHARED_SECRET="$OLD_RUNTIME_MANAGER_SHARED_SECRET"
export RUNTIME_IDENTITY_SECRET="$OLD_RUNTIME_MANAGER_SHARED_SECRET"
export RUNTIME_MANAGER_DEFAULT_NODE_ID=node__default
export RUNTIME_NODE_ID=node__default
# Use 1 only while the Manager URL is HTTP on an isolated private Docker network.
export RUNTIME_NODE_ALLOW_INSECURE_HTTP="${RUNTIME_NODE_ALLOW_INSECURE_HTTP:-1}"

docker compose up -d --pull never --no-build database-migrate
docker compose logs --no-color --tail=100 database-migrate
```

Proceed only when the migration log reports `MySQL schema version 17`.

## 3. Bootstrap the default node

Start the existing Runtime Manager and Gateway with the same local images and the default node settings.

```bash
docker compose up -d --pull never --no-build agent-runtime-manager codex-gateway
docker compose logs --no-color --tail=200 codex-gateway
docker compose logs --no-color --tail=200 agent-runtime-manager
```

The Gateway startup must complete the legacy node bootstrap phase, create `node__default` if it is missing, and backfill existing placements without changing runtime IDs. The identity secret must still equal `OLD_RUNTIME_MANAGER_SHARED_SECRET` at this stage.

## 4. Verify placements

Check the runtime-node tables before and after one Gateway restart.

```bash
mysql --defaults-extra-file="$MYSQL_BACKUP_CNF" -e "SELECT id, name, scheduling_state, config_revision FROM runtime_nodes ORDER BY id;"
mysql --defaults-extra-file="$MYSQL_BACKUP_CNF" -e "SELECT user_id, runtime_id, runtime_node_id, placement_generation, workspace_key FROM user_agent_runtimes ORDER BY user_id;"

docker compose restart codex-gateway
docker compose logs --no-color --tail=200 codex-gateway

mysql --defaults-extra-file="$MYSQL_BACKUP_CNF" -e "SELECT user_id, runtime_id, runtime_node_id, placement_generation, workspace_key FROM user_agent_runtimes ORDER BY user_id;"
```

Pass criteria:

- every existing runtime row points at `runtime_node_id = 'node__default'`;
- every placed row has `placement_generation = 1`;
- the `runtime_id` values do not change across the Gateway restart;
- the restart does not create new placements.
- every pre-existing Runtime keeps the same Docker container ID and named volume names.

## 5. Run the relay smoke

Smoke the signed Runtime Manager relay against one known runtime placement. Use placeholders for the runtime ID and generation from the SQL check above.

```bash
set +x
export RELAY_RUNTIME_ID="<runtime_id_from_sql>"
export RELAY_GENERATION="<placement_generation_from_sql>"
export RUNTIME_MANAGER_BASE_URL="${RUNTIME_MANAGER_BASE_URL:-http://agent-runtime-manager:8787}"
export RUNTIME_MANAGER_SHARED_SECRET="$RUNTIME_MANAGER_SHARED_SECRET"

node --input-type=module - <<'NODE'
import { createHmac, randomUUID, createHash } from 'node:crypto';
import WebSocket from 'ws';

const baseUrl = new URL(process.env.RUNTIME_MANAGER_BASE_URL);
const runtimeId = process.env.RELAY_RUNTIME_ID;
const generation = process.env.RELAY_GENERATION;
const secret = process.env.RUNTIME_MANAGER_SHARED_SECRET;
const path = `/v1/runtimes/${encodeURIComponent(runtimeId)}/generations/${generation}/rpc`;
const timestamp = String(Date.now());
const nonce = randomUUID();
const bodySha256 = createHash('sha256').update('').digest('hex');
const signature = createHmac('sha256', secret)
  .update(`GET\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`)
  .digest('hex');

const ws = new WebSocket(`${baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${baseUrl.host}${path}`, {
  headers: {
    'x-runtime-body-sha256': bodySha256,
    'x-runtime-nonce': nonce,
    'x-runtime-signature': signature,
    'x-runtime-timestamp': timestamp,
  },
});

await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

ws.close();
console.log('relay-smoke: ok');
NODE
```

If the socket does not open, stop and investigate before any second node work.

## 6. Rollback boundary

Before any node B placement exists, rollback is limited to the previous Gateway image while keeping the MySQL schema at migration 17 and preserving the named volumes.

```bash
docker compose stop codex-gateway agent-runtime-manager
docker image inspect "$PREVIOUS_CODEX_GATEWAY_IMAGE"
docker image inspect "$PREVIOUS_RUNTIME_MANAGER_IMAGE"
CODEX_GATEWAY_IMAGE="$PREVIOUS_CODEX_GATEWAY_IMAGE" \
RUNTIME_MANAGER_IMAGE="$PREVIOUS_RUNTIME_MANAGER_IMAGE" \
docker compose up -d --pull never --no-build codex-gateway agent-runtime-manager
```

Do not delete or recreate `mysql-data`, `runtime-manager-data`, or `capability-data` during rollback. Restore only from the backup artifacts if the host state is no longer trustworthy.

Once any runtime is placed on a non-default node, or any `runtime_nodes` row other than `node__default` is registered for production use, the old Gateway image is no longer a valid production rollback target.

## 7. Blocker list before a second node

Do not register node B until all of the following are true:

- every current user has a placement on `node__default`;
- the relay smoke above passes for at least one representative runtime;
- a cold Gateway restart preserves all `runtime_id` values and placements;
- the backup artifacts and SHA-256 files are stored off-host;
- the operator has confirmed that no command in this runbook required a secret literal or a repeated download.

If any of those conditions fails, stop here and keep the deployment single-node.

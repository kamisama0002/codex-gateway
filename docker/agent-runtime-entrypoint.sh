#!/bin/sh
set -eu

if [ -z "${CODEX_REMOTE_TOKEN:-}" ]; then
  echo "CODEX_REMOTE_TOKEN is required" >&2
  exit 1
fi

token_sha256="$(printf '%s' "$CODEX_REMOTE_TOKEN" | sha256sum)"
token_sha256="${token_sha256%% *}"
unset CODEX_REMOTE_TOKEN

export CODEX_REMOTE_TOKEN_SHA256="$token_sha256"
secret_dir="${CODEX_RUNTIME_SECRET_DIR:-/run/codex-secrets}"
attempt=0
while [ ! -f "$secret_dir/.ready" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 600 ]; then
    echo "Runtime secret injection timed out" >&2
    exit 1
  fi
  sleep 0.1
done
browser_supervisor="${CODEX_RUNTIME_BROWSER_SUPERVISOR:-/usr/local/lib/agent-runtime-browser-supervisor.mjs}"
exec node "$browser_supervisor"

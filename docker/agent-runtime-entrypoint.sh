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
config_helper="${CODEX_RUNTIME_CONFIG_HELPER:-/usr/local/lib/agent-runtime-config.mjs}"
exec node "$config_helper"

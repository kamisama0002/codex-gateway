#!/bin/sh
set -eu

if [ -z "${CODEX_REMOTE_TOKEN:-}" ]; then
  echo "CODEX_REMOTE_TOKEN is required" >&2
  exit 1
fi

token_sha256="$(printf '%s' "$CODEX_REMOTE_TOKEN" | sha256sum)"
token_sha256="${token_sha256%% *}"
unset CODEX_REMOTE_TOKEN

exec codex app-server \
  --listen ws://0.0.0.0:4500 \
  --ws-auth capability-token \
  --ws-token-sha256 "$token_sha256"

#!/bin/sh
set -eu

if [ -z "${CODEX_REMOTE_TOKEN:-}" ]; then
  echo "CODEX_REMOTE_TOKEN is required" >&2
  exit 1
fi

exec codex app-server --listen ws://0.0.0.0:4500 --remote-auth-token-env CODEX_REMOTE_TOKEN

#!/bin/sh
set -eu

if [ -z "${CODEX_REMOTE_TOKEN:-}" ]; then
  echo "CODEX_REMOTE_TOKEN is required" >&2
  exit 1
fi

token_sha256="$(printf '%s' "$CODEX_REMOTE_TOKEN" | sha256sum)"
token_sha256="${token_sha256%% *}"
unset CODEX_REMOTE_TOKEN

if [ -n "${CODEX_GATEWAY_PROVIDER_BASE_URL:-}" ]; then
  if [ -z "${CODEX_GATEWAY_PROVIDER_ID:-}" ] || [ -z "${CODEX_GATEWAY_MODEL:-}" ] || [ -z "${CODEX_GATEWAY_PROVIDER_TOKEN:-}" ]; then
    echo "Incomplete Gateway provider configuration" >&2
    exit 1
  fi
  # The token stays in the environment and is referenced by Codex's env_key; it is not written to
  # config.toml or argv. Provider values are validated by Runtime Manager before container create.
  printf '%s\n' \
    'model_provider = "codex_gateway"' \
    '[model_providers.codex_gateway]' \
    'name = "Codex Gateway"' \
    "base_url = \"${CODEX_GATEWAY_PROVIDER_BASE_URL}\"" \
    'env_key = "CODEX_GATEWAY_PROVIDER_TOKEN"' \
    'wire_api = "responses"' \
    > /codex-home/config.toml
fi

exec codex app-server \
  --listen ws://0.0.0.0:4500 \
  --ws-auth capability-token \
  --ws-token-sha256 "$token_sha256"

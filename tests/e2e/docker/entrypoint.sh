#!/usr/bin/env bash
set -euo pipefail

mkdir -p /home/codex/.ssh /home/codex/.codex /workspace
mkdir -p /home/codex/.local
chmod 700 /home/codex/.ssh
chown -R codex:"$(id -gn codex)" /home/codex/.ssh /home/codex/.local /home/codex/.codex

# A bind-mounted host credential can remain root-readable only. Stage an optional copy before
# sshd drops to the `codex` login so global E2E setup can install it into the user's CODEX_HOME.
if [ -s /run/secrets/codex-provider-key ]; then
  install -o root -g root -m 644 /run/secrets/codex-provider-key /run/codex-provider-key
fi

if [ -x /usr/local/bin/e2e-gpu-training ]; then
  runuser -u trainer -- /usr/local/bin/e2e-gpu-training >/dev/null 2>&1 &
fi

exec /usr/sbin/sshd -D -e

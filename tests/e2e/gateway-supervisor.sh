#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Gateway supervisor requires a child command" >&2
  exit 64
fi

shutdown_requested=0
active_pid=""

forward_shutdown() {
  shutdown_requested=1
  if [ -n "$active_pid" ] && kill -0 "$active_pid" 2>/dev/null; then
    kill -TERM "$active_pid" 2>/dev/null || true
  fi
}

wait_for_active_process() {
  set +e
  wait "$active_pid"
  set -e
  if [ "$shutdown_requested" -eq 1 ]; then
    set +e
    wait "$active_pid" 2>/dev/null
    set -e
    active_pid=""
    return 1
  fi
  active_pid=""
  return 0
}

trap forward_shutdown TERM INT

while [ "$shutdown_requested" -eq 0 ]; do
  "$@" &
  active_pid=$!
  wait_for_active_process || break

  # A crashing child must not turn PID 1 into a hot restart loop.
  sleep 0.25 &
  active_pid=$!
  wait_for_active_process || break
done

exit 0

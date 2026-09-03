#!/bin/sh
set -eu

mirror="${1:-}"
if [ -z "${mirror}" ]; then
  exit 0
fi

case "${mirror}" in
  *[!A-Za-z0-9._-]*)
    echo "invalid DEBIAN_MIRROR: ${mirror}" >&2
    exit 1
    ;;
esac

rewritten=0
for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do
  if [ -f "${source_file}" ]; then
    sed -i "s|deb.debian.org|${mirror}|g" "${source_file}"
    rewritten=1
  fi
done

if [ "${rewritten}" -eq 0 ]; then
  echo "no debian apt sources found to rewrite" >&2
  exit 1
fi

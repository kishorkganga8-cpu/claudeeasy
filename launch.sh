#!/usr/bin/env bash
# Run from Git Bash on Windows 11. Keep this terminal open while using the gateway.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
url='http://127.0.0.1:3848/'

if [[ -f ./node.exe ]]; then
  node_bin='./node.exe'
elif command -v node.exe >/dev/null 2>&1; then
  node_bin='node.exe'
elif command -v node >/dev/null 2>&1; then
  node_bin='node'
else
  echo 'Node.js 18 or newer is required. Install it, then run this script again.' >&2
  exit 1
fi

gateway_ready() {
  "$node_bin" -e 'fetch("http://127.0.0.1:3848/api/status").then(r => r.json()).then(j => process.exit(j.endpoint === "http://127.0.0.1:3848" ? 0 : 1)).catch(() => process.exit(1))' >/dev/null 2>&1
}

open_website() {
  powershell.exe -NoProfile -Command "Start-Process '$url'"
  echo "Claude Key Connect: $url"
}

if gateway_ready; then
  echo 'Gateway is already running.'
  open_website
  exit 0
fi

"$node_bin" server.js &
gateway_pid=$!
trap 'kill "$gateway_pid" 2>/dev/null || true' EXIT

for _ in {1..30}; do
  if gateway_ready; then
    open_website
    echo 'Keep this Git Bash window open while using Claude Code. Press Ctrl+C to stop.'
    wait "$gateway_pid"
    exit 0
  fi
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    wait "$gateway_pid"
    exit 1
  fi
  sleep 0.2
done

echo 'Gateway did not become ready on port 3848.' >&2
exit 1

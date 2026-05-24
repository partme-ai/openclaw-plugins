#!/bin/sh
# OpenClaw gateway entrypoint for E2E Docker service.
set -eu

PROFILE="${OPENCLAW_PROFILE:-queue-e2e}"
GATEWAY_PORT="${E2E_GATEWAY_PORT:-19789}"
REPO="${OPENCLAW_E2E_REPO:-/workspace}"
STATE="${OPENCLAW_E2E_STATE_DIR:-/state}"

export HOME="${OPENCLAW_E2E_HOME:-/root}"
mkdir -p "${STATE}"

cd "${REPO}"

OPENCLAW_CLI=""
if [ -f "${REPO}/node_modules/openclaw/openclaw.mjs" ]; then
  OPENCLAW_CLI="node ${REPO}/node_modules/openclaw/openclaw.mjs"
elif command -v openclaw >/dev/null 2>&1; then
  OPENCLAW_CLI="openclaw"
else
  echo "[openclaw-entrypoint] installing openclaw globally..."
  OPENCLAW_VER="$(node -p "require('${REPO}/package.json').devDependencies.openclaw")"
  npm install -g --no-audit --no-fund "openclaw@${OPENCLAW_VER}"
  OPENCLAW_CLI="openclaw"
fi

echo "[openclaw-entrypoint] profile=${PROFILE} port=${GATEWAY_PORT} state=${STATE}"
exec ${OPENCLAW_CLI} --profile "${PROFILE}" gateway run --force --allow-unconfigured --port "${GATEWAY_PORT}" --verbose --bind loopback

#!/usr/bin/env bash
set -e
# Clarity — one-command setup. Requires Node.js 18+.
command -v node >/dev/null 2>&1 || { echo "Node.js 18+ required: https://nodejs.org"; exit 1; }
echo "Installing dependencies…"
npm install --no-audit --no-fund
echo "Starting Clarity at http://localhost:3000"
npm start

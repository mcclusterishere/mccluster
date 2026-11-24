#!/usr/bin/env bash
# Shared World verification support used by Equity Uprise; no building capability.
# Explicit localhost:54322 only. Set NATIVE_TEST_DATABASE_URL and POSTGRES_MODULE_PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/test-world-member-fronts-native.mjs world "$@"

#!/usr/bin/env bash
# End-to-end test: requires `npm install` done in relay/ and uv available.
set -euo pipefail
cd "$(dirname "$0")/.."
exec uv run --project client python e2e/driver.py

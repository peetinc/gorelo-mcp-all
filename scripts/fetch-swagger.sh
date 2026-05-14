#!/usr/bin/env bash
# fetch-swagger.sh — pull Gorelo OpenAPI spec from the public Swagger endpoint.
# Spec is public — no auth required.
#
# Usage:
#   GORELO_BASE_URL=https://api.usw.gorelo.io ./scripts/fetch-swagger.sh
set -euo pipefail

BASE="${GORELO_BASE_URL:-https://api.usw.gorelo.io}"
BASE="${BASE%/}"

URL="$BASE/swagger/v1/swagger.json"
echo "Fetching: $URL" >&2

curl -fsSL -o swagger.json "$URL"
BYTES=$(wc -c < swagger.json | tr -d ' ')
echo "Saved swagger.json ($BYTES bytes)" >&2

#!/usr/bin/env bash
set -euo pipefail
: "${AZ_SUBSCRIPTION_ID:?Set AZ_SUBSCRIPTION_ID explicitly}"
: "${AZ_RESOURCE_GROUP:?Set AZ_RESOURCE_GROUP explicitly}"
: "${ENVIRONMENT:?Set ENVIRONMENT explicitly}"
[[ "$ENVIRONMENT" == staging ]] || { printf 'Only ENVIRONMENT=staging is permitted\n' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/staging.mjs" collect-results "$@"

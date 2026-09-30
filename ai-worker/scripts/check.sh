#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
uv run --frozen pytest "$@"
uv run --frozen coverage report --include='src/researchhub_worker/ai/*' --fail-under=80
uv run --frozen coverage report --include='src/researchhub_worker/ai/context.py' --fail-under=80

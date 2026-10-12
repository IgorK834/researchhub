#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
worker_python() {
    if command -v uv >/dev/null 2>&1; then
        uv run --frozen python -m "$@"
    else
        .venv/bin/python -m "$@"
    fi
}
worker_python pytest "$@"
worker_python coverage report --include='src/researchhub_worker/ai/*' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/ai/context.py' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/ai/safety.py' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/parsing/csv.py,src/researchhub_worker/tabular_contracts.py' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/data/*' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/analysis/*' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/parser_process.py,src/researchhub_worker/parsing/common.py' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/observability.py' --fail-under=80

worker_python coverage report --include='src/researchhub_worker/ai/telemetry.py' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/evaluation/*' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/ai/providers.py,src/researchhub_worker/ai/compatible_*.py,src/researchhub_worker/retrieval/embeddings.py' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/evaluation/models.py' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/ai/gemini*.py,src/researchhub_worker/retrieval/gemini.py' --fail-under=80
worker_python coverage report --include='src/researchhub_worker/ai/call_budget.py,src/researchhub_worker/evaluation/canvas.py' --fail-under=80

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
mkdir -p .demo
if [[ ! -f .demo/scale.env ]]; then
  python3 - <<'PY'
import secrets
from pathlib import Path
values = {name: secrets.token_urlsafe(36) for name in ("DEMO_DB_PASSWORD", "AI_WORKER_SERVICE_TOKEN", "METRICS_SCRAPE_TOKEN")}
Path(".demo/scale.env").write_text("".join(f"{key}={value}\n" for key, value in values.items()))
PY
fi
compose=(docker compose --env-file .demo/scale.env -f infra/demo/compose.scale.yaml)
if [[ "${1:-}" == "--dependencies-only" ]]; then
  "${compose[@]}" up -d --build --wait --wait-timeout 180 postgres azurite ai-worker
  printf 'Shared dependencies ready. Host backend: DB_PORT=15532, Azurite=11000, worker=18090.\n'
  exit 0
fi
"${compose[@]}" up -d --build --wait --wait-timeout 240
python3 - <<'PY'
import urllib.request
seen = set()
for _ in range(20):
    with urllib.request.urlopen("http://127.0.0.1:18080/actuator/health", timeout=5) as response:
        seen.add(response.headers.get("X-Replica-Id"))
    if seen == {"backend-1", "backend-2"}:
        break
if seen != {"backend-1", "backend-2"}:
    raise SystemExit(f"Both replicas must be healthy and observable; saw {seen}")
print("Healthy replicas: " + ", ".join(sorted(seen)))
print("API / load balancer: http://127.0.0.1:18080")
PY

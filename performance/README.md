# Repeatable API load scenarios (RH-326/RH-327)

Use only the [synthetic RC seed](../scripts/demo/README.md). The scripts refuse non-synthetic
accounts and check the backend model metadata before load. The demo worker pins both model and
embedding providers to `deterministic`; no paid model configuration enters the topology.

## Scenarios

| Script | Default | Requests / intent |
| --- | --- | --- |
| smoke.js | 5 VUs, 2 min, 1 s think time | All six read endpoints as a deployment smoke |
| api-read.js | 50 VUs, 2 min, 1 s think time | Workspace list/detail, sources, saved document, audit, analysis history |
| workspace.js | 50 VUs, 2 min, 1 s think time | Workspace list/detail/members |
| retrieval.js | 5 VUs, 2 min, 15 s think time | Workspace question with deterministic provider and validated citations |
| mixed-load.js | 50 → 100 → 200 → 0 VUs, 12 min, 20 s think time | 80% six-endpoint reads, 15% workspace reads, 5% questions |

Upload, ingestion, source comparison and AI authoring/generation are outside this read baseline.
The retrieval scenario exercises the real question pipeline; its offline extractive provider is
not representative of paid-model latency or answer quality. Mixed load preserves the production
60-question workspace quota; VUs include think time and are **not** simultaneous in-flight requests.

k6 `setup()` runs once globally. It logs in each of the pre-created accounts once, refreshes CSRF
after the login rotation, and returns one independent cookie/token pair per VU. Every VU installs
only its own pair and keeps the session for the run. Setup requests are tagged `phase=setup`;
reported endpoint latencies and request totals include only `phase=run`.

## Run

Install the pinned k6 **2.3.0** or use the same pinned Docker tool as `run-load.py`.

```bash
python3 scripts/ci/check.py performance  # k6 inspect for every script
node --test --experimental-test-coverage --test-coverage-lines=80 --test-coverage-branches=80 performance/test/*.test.js
BASE_URL=http://127.0.0.1:18080 SEED_FILE="$PWD/.demo/k6.json" \
  k6 run --summary-export=.demo/smoke-summary.json performance/k6/smoke.js
VUS=50 DURATION=2m BASE_URL=http://127.0.0.1:18080 SEED_FILE="$PWD/.demo/k6.json" \
  k6 run --summary-export=.demo/api-read-summary.json performance/k6/api-read.js
MAX_VUS=200 BASE_URL=http://127.0.0.1:18080 SEED_FILE="$PWD/.demo/k6.json" \
  k6 run --summary-export=.demo/mixed-summary.json performance/k6/mixed-load.js
python3 scripts/demo/run-load.py
```

Parameters: `BASE_URL` defaults to the local Caddy URL; `SEED_FILE` is required to run and is never
committed; `VUS` is bounded 1–200; `DURATION` overrides constant-VU scenarios; `MAX_VUS` bounds the
mixed peak; `THINK_TIME` overrides the scenario pause. Keep quotas in mind when changing pace.
The default auth setup deadline is five minutes for 200 distinct BCrypt logins.

Every HTTP request has a bounded `endpoint` tag, plus `phase`; runtime requests also have a stable
`name`. Thresholds require `http_req_failed < 1%`, successful checks >99% and exactly zero
authentication/CSRF failures. Per-endpoint p95 budgets live in
[k6/lib/baseline.json](k6/lib/baseline.json), frozen **after** the first recorded local baseline.
They are regression budgets for this fixture, not promised production SLAs. The baseline report
explains measured values and selected headroom; do not silently relax budgets after a failure.

## Evidence and interpretation

The [2026-10-08 two-instance report](results/2026-10-08-local-two-instance/README.md) contains
the recorded smoke, 50-VU read and deterministic retrieval baseline, the frozen p95 budgets,
session/failover and quota proofs, and every repeated run with its resources and source identity.

`run-load.py` retains two consecutive smoke and two consecutive 50-VU read runs by default.
Each runs for two minutes, exports its original k6 summary with `--summary-export`, and records
aggregate/endpoint p50, p95, p99, errors, auth failures and replica distribution.
It samples Docker CPU/memory, PostgreSQL connection count and protected Hikari active/idle/pending/max
gauges. The monitor connection is included in the database count.

Results are under `results/<yyyy-mm-dd>-local-two-instance/`: README, original summaries,
`k6-summary.json`, `metrics.csv`, `machine.json`, `commit.txt`, compose and recursive script hashes,
and the separate consistency proof. Raw k6 events and temporary logs remain ignored in unique
timestamped directories under `.demo/load/`. Existing result directories cannot be overwritten;
choose a fresh `--output` subdirectory when repeating evidence on the same day.
The hash binds sorted script paths **and bytes**, including latency budgets, so report changes
can be traced to the exact script set. Keep all planned runs, including failures.

This is a laptop closed-loop test on Docker Desktop. CPU saturation, JVM warmup/GC, local disks,
host workloads and container virtualization affect the measurements. It does not establish
Azure capacity, network latency, a sustained open-loop arrival rate, long-run retention behaviour,
or model quality. Compare endpoints and repeated runs on the same machine/settings, and investigate
Hikari pending connections plus request latency before increasing a pool or replica count.

CI inspects every script, tests pure configuration helpers with an 80% coverage gate, builds the
images, runs a real sandbox seed and verifies the two-replica smoke. CI evidence excludes
passwords, cookies, tokens and private state files.

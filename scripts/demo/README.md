# Synthetic RC lab and two-replica demo

RH-316/RH-325 use one reproducible workspace for video, collaboration, provenance and load tests.
Every source is authored for this project. The dataset is a simulation; it contains no private
data, real participant or external copyrighted material.

## Fixtures

`generate_fixtures.py` uses CPython 3.13.3's fixed seed **316**, fixed PDF metadata and sorted
uncompressed XLSX ZIP entries with fixed timestamps. It needs only Python's standard library.
The committed files and SHA256SUMS live in
[rc-circuit-lab](../../backend/src/main/resources/sample/rc-circuit-lab/):

* protocol and theory PDFs: nominal 10,000 ohm resistor, 470 microfarad capacitor, expected tau 4.7 s;
* XLSX: 243 positive voltage samples, three trials, 0–20 s, 0.25 s spacing, synthetic temperature;
* component notes: explicit tolerances and the nominal worst-case range.

```bash
python3 scripts/demo/generate_fixtures.py
python3 -m unittest discover -s scripts/demo -p 'test_*.py'
```

The workbook preserves the four physical columns `time_s`, `voltage_v`, `trial`, `temperature_c`;
its header is frozen and filterable. Numerical conclusions are computed from **all immutable rows**
in the real sandbox, never sampled preview rows.

## Seed with real execution, then scale with sandbox disabled

Prerequisites: Docker, host Java 25, Python 3.13.3 and a built backend JAR. Normal development
remains host-based; containers are required here for shared dependencies and isolation only.

```bash
docker build -t researchhub-sandbox:1.1.1 sandbox
(cd backend && ./mvnw verify)
scripts/demo/scale-up.sh --dependencies-only
python3 scripts/demo/seed-server.py > .demo/seed-server.log 2>&1 &
seed_pid=$!
python3 scripts/demo/wait-health.py http://127.0.0.1:18083/actuator/health/readiness
scripts/demo/seed.sh
scripts/demo/seed.sh
kill "$seed_pid"
wait "$seed_pid" || true
scripts/demo/scale-up.sh
python3 scripts/demo/consistency.py
```

The seed server is the existing Spring backend **on the host**, with the already reviewed local
Docker adapter and sandbox image 1.1.1. Its Docker socket is never granted to a service container
or generated program. Stop it before scaling: the load topology has exactly two replicas and
`ANALYSIS_SANDBOX_ENABLED=false`. Previously completed computations and their provenance remain
readable. Trying a new execution records the existing explicit sandbox-disabled failure.

`seed.sh` calls only public REST: CSRF, registration/login, workspace/member creation, upload,
processing polls, computation creation/planning/execution, document save, comments/replies and
grounded questions. It creates the report **RC Circuit Laboratory Report** with Objective, Theory,
Method, Measurements, Analysis, Discussion and Conclusion. The Analysis section embeds the exact
saved summary/table/chart references, preserving source version, code hash and runtime provenance.
The demo editor opens a tolerance review and the collaboration editor replies.

The grounded question is “What time constant should we expect from the component values?”
and must return a cited 4.7 s answer. “What was the room humidity during the experiment?”
must return explicit insufficient evidence. Both checks fail the seed if the contract differs.
The deterministic planner's RC fixture generates a validated program; it is not a general model
or a numerical evaluator in Spring.

The private owner, demo editor and collaboration editor receive generated passwords, printed
only on initial registration. `.demo/accounts.json` is mode 0600, ignored and preserved for
idempotence. `.demo/scale.env` contains independently generated local database/service/scrape
credentials. Do not commit, share or package either file. `.demo/k6.json` contains only pre-created
synthetic load users and fixture IDs, also mode 0600 and ignored.
Default `--load-users 200` supports the maximum mixed scenario; CI uses five.
Keep the state directory when reusing the database. Losing the generated credentials does not
authorize guessing or resetting existing accounts. Removing both private state and Compose
volumes is an explicit destructive reset, separate from an ordinary restart.

Running the seed again selects the owner's uniquely named workspace, matches every uploaded
source hash, reuses a successful real execution and preserves report edits by failing on changes.
It never silently replaces data. Keep one seed writer at a time; the public API does not provide
a concurrent seeding transaction.

## Topology and capacity

[Caddy](../../infra/demo/Caddyfile.scale) uses round robin and no sticky cookie. Direct backend
ports are loopback-only for diagnosis and the quota proof.

| Service | Host port | State/configuration |
| --- | --- | --- |
| Caddy | 18080 | Balances backend-1/backend-2; active readiness plus passive failure detection |
| Backend replicas | 18081, 18082 | demo profile; JDBC sessions; PostgreSQL quotas; pool maximum 8, minimum 2 |
| PostgreSQL | 15532 | one pgvector PostgreSQL 17 database, max_connections=50; Flyway is the schema writer |
| Blob stand-in | 11000 | one persistent Azurite store shared by both replicas |
| AI worker | 18090 | deterministic model and embedding adapters; no paid model credentials |
| Host seed backend | 18083 | temporary real sandbox adapter; stopped before the scale test |

`scale-up.sh` waits for health and proves that both replica IDs appear through the load balancer.
All backend responses include `X-Replica-Id`; structured application logs carry `replicaId`.
`INSTANCE_ID` / `researchhub.instance-id` overrides the default hostname resolved before logging
starts. This bounded diagnostic value contains no user or workspace data.

The existing budget is applied: `2 × (8 + 2) = 20 <= 0.8 × 50 = 40`, and also below
80% of 35 usable connections on the smallest managed tier. Scheduler work shares each replica's
single Hikari pool. See [persistence](../../docs/development/persistence.md) for rollout/reservation
headroom and pending-connection alerts; this laptop is not evidence for a managed tier's throughput.

`consistency.py` checks 100 requests from one login across both replicas, stops backend-1, checks
20 more with the **same** session, and restores the replica. A fresh synthetic workspace then
receives 128 concurrent costly requests, explicitly split across direct replica ports. Four users
avoid making the per-user 20/minute cap the aggregate bottleneck: exactly the workspace 60/minute
limit must be admitted, and 68 must receive 429. The probe uses an empty source selection and checks
the real no-evidence API result; its purpose is admission atomicity, not model latency.
The run must remain in one aligned minute window. Repeat after the shared user window resets.

See [performance execution](../../performance/README.md) and
[scalability evidence](../../docs/architecture/scalability.md).

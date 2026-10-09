# Local portfolio demo (RH-315 / RH-319 / RH-332)

From the repository root:

```bash
scripts/demo/up.sh
```

Prerequisites: Java **25**, Node/npm (Node 25 or 26), Python **3.13**, Docker with
Compose **2.24.4+**, a local Unix Docker socket, and enough disk/memory for the existing
Python sandbox. Docker Desktop must be running on macOS; Linux uses the local Docker Engine.
No cloud account, model key or paid service is needed. The first build needs internet access
for Maven/npm and pinned container images. Subsequent starts reuse successful builds.

The command builds the backend JAR, the production Webpack/Babel frontend, missing worker,
collaboration and Caddy images, and `researchhub-sandbox:1.1.1`. It waits for readiness,
seeds the authored synthetic RC laboratory via the existing public REST API, restarts Spring
with registration disabled, starts the edge, and runs an authenticated smoke check.
It prints **https://localhost:8443** and two generated editor logins. Private passwords,
service credentials, process state and logs stay in ignored `.demo/local/` (mode 0700/0600).
This state is separate from the existing two-instance performance stack.

For live AI, put `GEMINI_API_KEY=…` in the ignored root `.env` and run the same startup command.
It seeds deterministically, switches the existing worker to native Gemini, and explicitly rebuilds
the demo source index using Gemini embeddings. Subsequent starts preserve the index when its
identity matches; interrupted reprocessing resumes. Provider settings and keys stay out of Spring
and frontend build processes. [Native Gemini setup, account limits and live checks](../development/native-gemini.md).

The HTTPS certificate comes from Caddy's local CA. On the first browser visit, trust the
certificate or import `.demo/local/root.crt` into your browser/OS trust store. Caddy runs in
Docker and cannot install host trust automatically; the script deliberately does not alter
the OS trust store. The automated smoke verifies TLS with that exact CA; the browser E2E
uses an isolated test context that accepts the local certificate. See
[Caddy local HTTPS](https://caddyserver.com/docs/automatic-https#local-https).
Use `localhost`, rather than the IP address, so the certificate and WebSocket origin match.

## Runtime and topology

| Component | Address | Responsibility |
| --- | --- | --- |
| Caddy | `127.0.0.1:8443` | HTTPS, production frontend, `/api/*`, WebSocket `/collaboration`, SPA fallback |
| Spring host process | `127.0.0.1:28081` | Java modular monolith, server authorization, Flyway, durable queues |
| PostgreSQL | `127.0.0.1:25432` | pgvector 0.8.2 / PostgreSQL 17, sessions and quotas |
| Azurite | `127.0.0.1:21000` | Local Blob storage |
| AI worker | `127.0.0.1:28090` | Deterministic Python fixtures and extraction |
| Collaboration | `127.0.0.1:28091` | Hocuspocus; Spring owns authorization and persistence |

Only Caddy is the browser origin. Internal collaboration routes are not exposed by Caddy.
The demo profile consumes Caddy's forwarded scheme/host so same-origin HTTPS requests pass
the empty CORS allowlist. Keep the host backend bound to loopback behind the trusted edge.
All published/internal host ports bind loopback. macOS reaches Spring through
`host.docker.internal`; Linux automatically applies `compose.demo.linux.yaml`, with Caddy
and collaboration on the host network and explicitly bound to `127.0.0.1`. This avoids
opening the backend on the LAN to work around Linux's host-gateway/loopback distinction.

Spring remains on the host because `DockerSandboxRunner` stages host files and asks the local
Docker daemon to bind-mount them into isolated one-shot containers. Containerizing Spring would
require a second path mapping and Docker socket access from a service container. The existing
trusted adapter retains its pinned image, resource limits and execution provenance.
The script checks PID identity before stopping a process; PID reuse cannot stop another app.

The seed backend briefly permits registration, with insecure cookies only for its HTTP loopback
client. Caddy and collaboration are stopped during this phase. `finally` stops that backend on
seed failure. The final backend uses `local,demo`, secure cookies, no cross-origin allowlist,
10 MiB sources, hourly quotas, collaboration, and disabled registration. On success, the stored
analysis was computed in the real Python sandbox; fixture AI supplied only the deterministic
plan and evidence responses.

| Hourly category | Per user | Per workspace |
| --- | ---: | ---: |
| LLM | 10 | 30 |
| Analysis | 3 | 10 |
| Retrieval | 60 | 180 |

Every demo page shows the portfolio warning. Ask AI and authoring identify
**Fixture AI (deterministic)**. A live provider instead shows **Live model: name**.
`GET /api/public/config` is anonymous and publicly cacheable for 60 seconds. Its complete
contract is `{environment, demo, registrationMode, ai: {mode, modelName}}`; deterministic AI
has a null model name. Identity comes from the worker's actual model metadata, rather than a
separate frontend build flag. Credentials and internal URLs are not returned.

## Stop, resume and reset

```bash
scripts/demo/down.sh                 # Stop the host backend and Compose; preserve all data
scripts/demo/up.sh                   # Resume without reseeding or replacing user edits
scripts/demo/reset.sh                # Explicitly delete this stack's volumes, then seed again
python3 scripts/demo/stack.py smoke  # Check TLS, login, document, execution/chart and API rejection
```

Reset uses `docker compose down -v` only for `researchhub-demo`, removes its seed/account state
and re-runs the baseline. It does not touch the development or scale stacks. Reset also rotates
the local Caddy CA; import the new root if you chose to trust the previous one. Keep `.demo/local/`
with the database volumes: missing passwords do not authorize overwriting existing accounts.
A second ordinary `up.sh` retains source hashes, execution IDs, credentials and authored edits.

Inspect `.demo/local/backend.log` and `docker compose --env-file .demo/local/demo.env
-f infra/demo/compose.demo.yaml logs` for failures; add the Linux overlay on Linux.
Builds are keyed by source content, not just the presence of an old JAR or bundle. Concurrent
invocations are serialized with a file lock. The initial target is 10 minutes with prerequisites
installed; a second unchanged start must finish in 2 minutes. Local timing depends on the machine,
registry bandwidth and dependency caches. Automated Linux acceptance enforces these bounds.

## Registration policy

`researchhub.auth.registration.mode` (`REGISTRATION_MODE`) accepts `open`, `invite-only` or
`disabled`, with startup rejection for other values. Local defaults to open; demo and Azure
default to disabled. Server enforcement is inside `UserRegistrationService`, before email lookup
and password hashing, and applies to non-HTTP callers as well. Closed registration uses the
standard 403 `FORBIDDEN` contract and never reveals whether an address exists.

**Task 30.2 is not implemented.** By the agreed RH-332 scope, invite-only currently rejects
every registration, including arbitrary invitation-token fields. `RegistrationInvitations` is
the explicit future boundary for atomic token redemption and account creation; its current
adapter denies access. The frontend hides all registration links and shows a clear notice on
the direct route in both closed modes, including while configuration is unavailable.
V38 stores anonymous `REGISTRATION_REJECTED` events containing only the request ID, mode and
time, with no submitted email, password, token, IP address or user name.

## Verification

```bash
cd backend && ./mvnw verify
# From the repository root:
npm --prefix frontend run test:coverage -- --runInBand
npm --prefix frontend run build
npm --prefix collaboration test
python3 -m unittest discover -s scripts/demo -p 'test_*.py'
node frontend/e2e/demo-smoke.mjs
```

The browser smoke signs in both editors, checks the demo banner and fixture chip, opens the
seeded report through same-origin WSS with secure sessions, and verifies the blocked Register
route. On Linux, install Playwright Chromium (`npm exec --prefix frontend -- playwright install
--with-deps chromium`); `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an installed Chromium.
The Python orchestration has an 80% coverage gate; runtime policy and UI gates also require 80%.
See [dispatcher evidence](../architecture/dispatcher-concurrency.md) for RH-328.

### Recorded local verification (2026-10-08)

macOS 15.7.4 / arm64, Java 25.0.2, Node 25.6.1, Docker Desktop; dependency and image caches warm:

| Check | Result |
| --- | --- |
| Reset, fresh frontend build, new volumes and real sandbox seed | 75.3 seconds; authenticated HTTPS smoke passed |
| Next unchanged `up.sh` | 4.8 seconds; account/manifest hashes, backend PID and saved document unchanged |
| Browser after reset | Both editors signed in, secure cookies, same-origin WSS, banner, fixture chip and closed Register route |
| Full backend `verify` | 1,180 tests, zero failures/errors, 11 existing skips; all JaCoCo gates passed |
| Demo/registration backend coverage | 92.06% lines, 91.67% branches |
| Full frontend coverage suite | 117 suites / 1,096 tests passed; new runtime/banner/chip/notice components 100% |
| Orchestration | 27 demo script tests passed; `stack.py` 96% combined line/branch coverage |

These timings do not establish a cold download time on another machine. The `local-demo` CI job
in [ci.yml](../../.github/workflows/ci.yml) tests a clean Ubuntu x86-64 runner with the 600/120-second
bounds, reset and browser smoke. That Linux job was added here; its remote execution has not been
observed in this macOS workspace. Local evidence stays in ignored `.demo/local/timings.json` and
`.demo/local/browser/`; CI exports only timing and browser evidence, never account/service secrets.

Public hosting and Azure provisioning remain separate tasks.

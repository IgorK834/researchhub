# ResearchHub — portfolio, enterprise-readiness and remaining work

> Status: working plan, written 2026-10-07 after a review of the repository and all 193 GitHub issues.
> Scope: (1) what is done and what is left, (2) how to present the project and what to do when a recruiter
> wants it live, (3) enterprise-readiness gaps, (4) product gaps and changes, (5) an ordered plan.
>
> Two goals drive every decision below:
>
> 1. Make the codebase **enterprise-ready and prove it** (shared state, IaC, load evidence, security, ADRs).
> 2. Keep the **recurring cost of the public demo at or near zero**. Nothing in this plan requires an
>    always-on paid server.
>
> Facts marked *(verified)* were checked against the code on the date above. Prices and free-tier limits are
> from memory and must be re-checked before relying on them.

---

## 1. Where the project stands

### 1.1 Size and shape *(verified)*

| Component | Files | Approx. lines | Notes |
|---|---|---|---|
| `backend/` main | 328 | 19.6k | Spring Boot 4.1.1, Java 25, modular monolith, 33 Flyway migrations |
| `backend/` tests | 123 | 18.3k | Testcontainers (PostgreSQL 17 + Azurite), JaCoCo gates per module |
| `frontend/` | 358 | 50k incl. tests/CSS | React + TS + Webpack, Jest, Playwright scripts in `frontend/e2e/*.cjs` |
| `ai-worker/` | 52 | 6.5k incl. tests | FastAPI, parsers in isolated subprocess, provider abstraction |
| `collaboration/` | 8 | 0.4k | Hocuspocus/Yjs, persists through Spring |
| `sandbox/` | 4 | 0.7k | Pinned scientific Python image |
| `docs/` | 37 development docs, 7 ADRs | | |

The test-to-code ratio in the backend (~0.93) and the security work (CSP, prompt-injection boundary, upload
hardening, quotas, audit, secret scanning) are the strongest parts of the repository. Keep them visible.

### 1.2 Issue audit (193 issues: 158 closed, 35 open)

**Closed (158).** Epics 1–19 and 23 are done: repo standards, backend/frontend foundation, auth, workspaces/RBAC,
documents, source storage, parsing, indexing/RAG, AI authoring, dataset inspection, analysis sandbox and
provenance, realtime collaboration, comments/audit, security hardening, observability, and export
(DOCX/PDF/LaTeX). The UI primitive issues (3.7–3.20 and the `.x` follow-ups) are done as well.

**Open (35).** Grouped by what I recommend doing with them:

| Issue(s) | Title (short) | Recommendation |
|---|---|---|
| #81 | Sandbox threat model + ADR | **Do now, retroactively.** The sandbox (#82–#84) shipped while this issue is still open, and its own acceptance criterion says no implementation may start before the ADR. Write `ADR-008-analysis-sandbox.md` from `docs/development/analysis-execution.md` and the `DockerSandboxRunner` flags (`--network none`, `--read-only`, `--ipc none`, uid 65532, `--cap-drop ALL`, `no-new-privileges`), include the cloud mapping, close. |
| #114 | GitHub Actions CI pipeline | **Re-scope, then close.** `.github/workflows/security.yml` already runs worker checks, frontend lint/coverage/build, collaboration build, sandbox build and `./mvnw verify`. What is missing is a correctly named `ci.yml` (keep security separate), Bicep validation and k6 syntax checks. |
| #115 | PR quality gate / branch conventions | Keep, small. Branch protection + required checks + PR template. |
| #116 | Build container images | **Keep, needed.** Only `ai-worker/` and `sandbox/` have Dockerfiles *(verified)*. Backend, frontend (static) and collaboration need them for Azure and for a one-command local demo. |
| #117, #118 | Azure ADR + IaC | **Keep.** Choose Bicep. The ADR must state the demo-vs-production split. |
| #119, #120, #121, #128, #129 | Azure PostgreSQL, Blob, Container Apps, Key Vault, App Insights | **Keep as IaC + one validation window** (section 5, phase 5). Do not run them permanently. |
| #122 | Deploy frontend | Re-scope: serve the static bundle from the edge/Caddy for demo; Static Web Apps or Front Door storage for the Azure reference. |
| #123 | Foundry model provider | **Mostly done in code** (`FoundryModelProvider` exists). Re-scope to "configuration, deployment and evaluation on Azure". |
| #124 | Azure AI Search | **Drop.** pgvector is the retrieval engine *(verified in migrations)*; adding a second engine contradicts the "PostgreSQL is the shared state store" story. Close with a note. |
| #125 | Azure Document Intelligence | **Defer/drop.** Cost and no demo value; revisit only if scanned-PDF OCR becomes a requirement. |
| #126 | Azure Service Bus for jobs | **Defer.** The PostgreSQL dispatcher (transactional claim, retry, stale recovery) is a defensible design. Document it as a deliberate choice in an ADR instead. |
| #127 | Sandbox on Container Apps Jobs | **Defer to ADR + roadmap.** Highest effort and least certain fit (no-network, immutable inputs, provenance). Do not promise it. |
| #131–#133 | RAG evaluation dataset/runners | **Raise priority.** These are the only way to show the AI is *good*, not just *safe*, and they are required to choose a cheap provider for the demo (section 3). |
| #138, #139, #140 | Bibliographic metadata, tags/folders, source search | **In progress** — the working tree contains uncommitted `SourceBibliography`, `SourceOrganization`, `SourceSearch`, `BibliographicMetadata`, `SourceLabels`. Finish, test, commit, and wire into export (bibliography). |
| #193 | Command search dialog | Keep; depends on #140. |
| #141 | External literature search (separate trust mode) | **Drop for now.** It breaks the "grounded in your sources" principle and adds an external-content injection surface. |
| #142 | Authorization test matrix | **Keep, high value.** One parametrized test that walks every workspace-owned endpoint × role × foreign-workspace. Not audited by me — check what already exists in `security/` and `workspace/` tests first. |
| #143 | Architecture tests | **Keep.** Add ArchUnit (not present *(verified)*) to enforce the module rules documented in `backend-architecture.md`. |
| #144 | Browser E2E foundation | **Re-scope.** E2E exists as bespoke `.cjs` scripts. Move to `@playwright/test`, run in CI, add axe accessibility checks. |
| #145, #146 | Ingestion fixture corpus, sandbox adversarial suite | Partly present (`ANALYSIS_SANDBOX_TESTS=true`, `contracts/`). Audit, fill gaps, close. |
| #147, #148, #150 | Setup guide, ADR upkeep, diagrams | Mostly docs. See ADR gaps in 4.3 and the diagram list in 2.4. |
| #149 | OpenAPI | **Keep.** Absent *(verified)*. Generate from the code, publish as a CI artifact, use it for contract tests. |

New issues to open are listed in section 5.

---

## 2. Presenting the project (portfolio)

### 2.1 Is a recorded video enough?

For most recruiters, **yes — and it is the primary asset**, not a fallback. Hiring managers and recruiters
rarely register an account and upload files to someone's demo. They watch 60–90 seconds, skim the README, and
open the code if the first two impressed them. A live always-on server mostly protects against a question that
a video also answers, and it costs money, needs patching and exposes a code-execution feature to the internet.

What does need to exist is an answer to "can you run it for me right now?". That is the interview kit in 2.3.

### 2.2 Recommended presentation stack (all free)

1. **README rewrite (highest priority).** The current README opens with "Browser deployment and prompt-injection
   protection (RH-182/RH-183)…" followed by a list of ticket numbers *(verified)*. A visitor learns nothing in
   the first screen. Restructure to: one-sentence pitch → hero screenshot/GIF → 90-second video link →
   architecture diagram → quick start (one command) → status table → links to ADRs/docs. Move the RH-xxx index to
   `docs/`.
2. **Video, two cuts.** A 60-second cut for the portfolio card and a 3–4 minute walkthrough:
   upload sources → grounded question with citations and an honest "insufficient evidence" answer → draft a
   section → two browsers editing live → analysis plan → sandbox run → chart + provenance → export.
   Script it on the seeded demo workspace so it is repeatable and re-recordable.
3. **Case study page** on `igorkadziela.dev/projects/researchhub` (sections as in your plan, #68): problem,
   product, architecture, grounded AI, reproducible analysis, collaboration, security, data integrity,
   scalability, trade-offs, known limitations. Include three diagrams: product architecture, local/demo
   deployment, Azure reference.
4. **Evidence block:** CI badge, coverage numbers, ADR list, the load-test report (once it exists), a status
   table that is honest about what is planned.
5. **Optional, only when actively job-hunting:** an on-demand hosted demo (see 2.5).

### 2.3 Interview kit — "run it live"

The product is already proven to run locally with Docker (the backend tests build the sandbox image and run
real computation). Turn that into a guaranteed 3-minute start:

- `scripts/demo/up.sh` — pulls/builds images, starts `postgres`, `azurite`, `ai-worker`, the backend,
  collaboration and the static frontend, waits for health, seeds the demo workspace, prints the URL and two demo
  logins. Idempotent. Tested on a clean checkout.
- `scripts/demo/reset.sh` — returns to the known baseline (the `docker compose down -v` + re-seed path).
- **Seed workspace "RC Circuit Lab"** shipped as fixtures in the repo (synthetic PDFs/XLSX, a draft report,
  the two scripted questions, one pre-run analysis). Also exposed in the product as **"Create sample workspace"**
  on the first-run empty state — this doubles as onboarding UX.
- **Offline-safe AI.** The deterministic provider already exists. For the live demo, support two modes with an
  explicit on-screen banner so nobody mistakes fixtures for a model: `deterministic` (works with no network)
  and a real provider via an environment variable. Rehearse both.
- **Pre-flight checklist** (print it): Docker running, images pre-pulled, ports free, `up.sh` run once that
  day, provider key present, both browsers logged in, the video open as plan B.
- **Plan B / C:** screen-share the video; walk the code (session model, quota atomicity, claim query,
  sandbox flags).
- **Run it on your own laptop, not a shared server.** The analysis feature executes model-generated Python
  through the Docker socket (root-equivalent). That is acceptable on your own machine in front of one
  person; it is not acceptable to expose it publicly without a dedicated, disposable VM.

### 2.4 Diagrams to produce (#150)

1. Current product architecture (modules, worker, collaboration, storage).
2. Local/demo deployment.
3. Azure production reference, with scale ranges marked: Spring `2..N`, AI worker `0..N`, collaboration
   single writer, PostgreSQL/Blob managed.
4. Scaling bottlenecks and the adapter that removes each (session → JDBC, quota → PostgreSQL,
   sandbox → isolated jobs, collaboration → coordinated rooms).

### 2.5 If you do want a hosted demo — cheapest options, in order

Re-check all numbers before choosing.

1. **None** (video + interview kit). Recommended default.
2. **Hosted only while job-hunting, billed hourly.** An hourly-billed VPS (e.g. Hetzner) created from a snapshot
   for a few weeks and deleted afterwards; store only the snapshot. Cost is a few euro, not a standing
   subscription.
3. **Oracle Cloud Always Free (ARM, large RAM).** Genuinely free, but capacity can be hard to obtain, idle
   instances can be reclaimed, and the pinned sandbox runtime must be rebuilt for arm64.
4. **Laptop + Cloudflare Tunnel (free)** switched on for scheduled interview windows only. Disable live
   sandbox execution in this mode, or replay pre-recorded analyses.

Whichever you pick, the hosted instance needs: registration disabled (see 4.1), the demo-account quotas from
your plan, a daily reset, a "do not upload confidential data" banner, and a dedicated host with nothing else on it.

---

## 3. AI provider for a near-zero demo

*(verified)* The worker has exactly two providers: `FakeModelProvider` (`deterministic`) and
`FoundryModelProvider`, which hard-codes the Azure path `/openai/v1/chat/completions`, the `api-key` header and
`json_schema` strict mode.

Consequences and actions:

- There is no adapter for a cheap or free OpenAI-compatible endpoint (Cloudflare Workers AI, Groq, OpenRouter,
  Gemini's compatible endpoint, a local Ollama). Add `OpenAiCompatibleModelProvider` (Bearer auth, configurable
  base URL) — small, and it strengthens the "provider abstraction" claim with real evidence.
- Many free/small models do not honour strict JSON-schema output reliably. The grounded-answer and citation
  contracts will fail more often. Plan for: schema-repair retry with a hard cap, a clear
  `AI_OUTPUT_INVALID` UX, and a model chosen **using the evaluation runners (#131–#133)** rather than by guess.
- Embeddings: the schema stores the dimension per embedding model (`retrieval_embedding_models`), so changing
  model is a reprocessing event, not a migration. Confirm the ANN index strategy per dimension before
  switching and never swap models silently.
- Keep deterministic for tests and load tests (no paid calls under load).

---

## 4. Enterprise-readiness: gaps and changes

### 4.1 Verified blockers to multi-replica operation

| Gap | Evidence | Fix |
|---|---|---|
| HTTP session is per-node | `SecurityConfiguration` uses `HttpSessionSecurityContextRepository`; no `spring-session` dependency in `pom.xml` | Spring Session JDBC, schema owned by Flyway, test with two instances |
| Quota is per-node | `InMemoryCostQuotaStore` is the only `CostQuotaStore`; the config comment says a multi-instance deployment "needs an atomic shared store" | `PostgresCostQuotaStore`, atomic user+workspace admission, concurrency test with two clients |
| `cloud` profile is a scaffold | `application-cloud.yaml` excludes DataSource, Flyway, Hibernate and Spring Data JPA autoconfiguration | Replace with a real `azure` profile (DataSource, JPA `validate`, Flyway, shared session/quota, internal worker URL) |
| Azure Blob adapter is local-only | `AzureBlobStorageConfiguration` is `@Profile("local")` | Split SDK adapter from Azurite-specific settings; add managed-identity path |
| Profile hack | About 40 product beans carry `@Profile("local")` *(verified)*, so any other profile silently loses services (controllers, stores, dispatchers) | Make product beans unconditional; let profiles select **adapters only** (storage, quota store, sandbox runner, provider). Add a test that boots the `azure` profile against Testcontainers and asserts the bean graph. |
| No registration switch | No configuration flag for registration was found | `researchhub.auth.registration.enabled` (+ invite-only mode); required for any public deployment |
| Only worker/sandbox are containerised | `Dockerfile` exists only in `ai-worker/` and `sandbox/` | Backend (layered JAR, non-root), collaboration, and a static-frontend image or Caddy config |
| Sandbox tied to the local Docker socket | `DockerSandboxRunner` only | Keep for demo; Azure adapter is a documented roadmap item, not a promise |
| Collaboration is single-writer | ADR-007 | Keep as `replicas=1`, document honestly; scale-out is an ADR + roadmap |

**Free proof of horizontal scaling.** You do not need Azure to validate the two most important claims. Run
**two backend instances behind Caddy/nginx against one PostgreSQL** in a Compose override and add a test that
(a) logs in through instance A and calls instance B, and (b) hammers both instances and asserts the global quota
is exact. Commit the test and the k6 script; this evidence is real and costs nothing. Azure then repeats it at
larger scale in a single paid day.

### 4.2 CI / supply chain

- Rename/split: today `security.yml` ("security regression") runs the whole pipeline. Create `ci.yml`
  (build, test, coverage) and keep `security.yml` for scans.
- Add jobs: `az bicep build` + lint, k6 script syntax, container image builds, OpenAPI generation, ArchUnit
  (runs with `verify`).
- Images tagged by commit SHA and recorded by digest; never `latest` as source of truth.
- Check what must stay tracked: `security-reports/` (generated scan output, ~3.4 MB) and
  `design-reference/*.pdf` (84 MB working tree) are in the repository *(verified: 16 tracked files)*. Prefer
  CI artifacts for generated reports and keep design PDFs out of the main history if they are large.

### 4.3 ADR gaps

Existing: ADR-001…007. Add:

| ADR | Content |
|---|---|
| ADR-008 | Analysis sandbox threat model (closes #81) |
| ADR-009 | Shared state: sessions and quotas in PostgreSQL (why not JWT, why not Redis) |
| ADR-010 | Deployment topology: demo vs Azure reference vs ephemeral validation |
| ADR-011 | Durable processing in PostgreSQL vs a broker (why not Service Bus yet) |
| ADR-012 | Report export pipeline (DOCX/PDF/LaTeX, retention, async dispatch) |
| ADR-013 | Collaboration scale-out options (single writer today; lease / idempotent persistence / partitioning) |
| ADR-014 | Data retention and erasure vs immutable history (see 5.2) |

### 4.4 Optional enterprise features that pay off in interviews

- **Entra ID / OIDC sign-in** as an additional login adapter that still produces the same server session.
  Strong Azure narrative; keep password login for local/demo.
- **Account lifecycle:** change password, password reset, email verification (SMTP adapter with a local sink),
  session list and "sign out everywhere". Sessions in PostgreSQL make the last one trivial.
- **Admin/operations:** audit-log export, retention job, per-workspace AI budget view (telemetry already exists).
- **Runbook:** backup/restore with a tested restore, RPO/RTO statement, alert list (`docs/operations.md`).

---

## 5. Product: what to improve, add or change

### 5.1 Highest value additions

1. **Sample workspace + guided first run.** Fixes the empty first-run problem for real users and is the demo
   seed. Small effort, large effect.
2. **Evaluation harness (#131–#133).** Retrieval recall@k, citation validity, refusal on unanswerable
   questions, prompt-injection fixtures (already present) — reported as a table in the README. Differentiates
   the project from "RAG wrapper" portfolios.
3. **Bibliography and citation styles in export.** With #138 in progress, add CSL-based styles (APA/IEEE),
   a generated reference list in DOCX/PDF/LaTeX, and DOI-based metadata prefill (Crossref lookup on the
   user-supplied DOI only; this is not the dropped external-search feature).
4. **Source search and command palette (#140, #193).** Finish and wire to retrieval filters (tags/folders).
5. **Invitations for non-registered users** (invite link/token). Today members are added only by the email of an
   existing account.

### 5.2 Things to change or revisit

- **Immutable history vs erasure.** Append-only versions, audit and provenance are a strength, but a real
  product needs an answer to "delete my account/data". Decide and document (ADR-014): tombstoning,
  cryptographic erasure of blobs, retention windows.
- **Provenance UI.** Provenance is deep in the backend; make sure a user can reach "where did this sentence/
  number come from" from the document in two clicks, with the executed code hash, input hashes and runtime
  identity visible. This is the product's differentiator — show it in the video.
- **Analysis scope.** One sandbox image with fixed libraries is correct. Add a visible capability list and
  clear failure messages for unsupported requests; record failure cases in the adversarial suite.
- **Accessibility and performance.** Add axe checks to Playwright, a Lighthouse budget, and route-level
  code-splitting for the editor/analysis pages (the frontend is ~50k lines).
- **Backend reliability polish.** Make worker-call timeouts, retry/backoff and circuit-breaker behaviour
  observable (metrics exist); add a documented behaviour for "worker down" in the UI.
- **Localisation.** Optional: Polish/English UI. Low priority; do not start before the items above.

### 5.3 Explicitly not doing (to protect scope)

Microservices split, JWT migration, Redis (until collaboration scale-out needs it), Service Bus, Azure AI
Search, Document Intelligence, external literature search, Kubernetes, multi-region, a 1M-user benchmark.

---

## 6. Ordered plan

Effort: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ 1–2 weeks. Everything through phase 4 is free.

### Phase 0 — Housekeeping (S–M)

- [ ] Finish, test and commit the in-progress source work (#138, #139, #140); close them.
- [ ] Triage issues per section 1.2 (close #124/#125/#126/#141 as "won't do now", re-scope #114/#122/#123/#127/#144).
- [ ] Write ADR-008 and close #81.
- [ ] Rewrite the README front page; move the RH index to `docs/`.
- [ ] Decide what generated artifacts stay tracked (4.2).

### Phase 1 — Horizontal-scale foundations (M–L)

- [ ] Spring Session JDBC with Flyway-owned tables; cross-instance session test.
- [ ] `PostgresCostQuotaStore`; two-client atomicity test (no oversubscription, no double count, correct 429).
- [ ] Profile cleanup: unconditional product beans, adapter-only profiles; `azure` profile boot test.
- [ ] Azure Blob adapter split from Azurite settings.
- [ ] Registration flag and invite-only mode.
- [ ] Two-instance Compose override + Caddy + k6 scripts run locally; save results in `performance/results/`.
- [ ] ADR-009, ADR-011.

### Phase 2 — Demo kit and AI provider (M)

- [ ] Backend/collaboration/frontend images (#116); `scripts/demo/up.sh` and `reset.sh`.
- [ ] Seed fixtures and "Create sample workspace" action.
- [ ] `OpenAiCompatibleModelProvider`; provider choice informed by the evaluation harness.
- [ ] Demo banner, demo accounts (non-owner), demo quotas.
- [ ] Record both video cuts; build the case-study page; draw the diagrams.

### Phase 3 — Quality evidence (M–L)

- [ ] Evaluation harness (#131–#133) with a published results table.
- [ ] Authorization matrix test (#142), ArchUnit (#143), OpenAPI (#149), Playwright migration + axe (#144).
- [ ] `ci.yml` split; image builds in CI.
- [ ] Audit fixtures/adversarial suites (#145, #146).

### Phase 4 — Azure as code (M–L)

- [ ] ADR-010 and the Azure ADR (#117); Bicep skeleton and modules (#118–#121, #128, #129).
- [ ] `staging.bicepparam` / `production.bicepparam`; `az bicep build` + `what-if` in CI.
- [ ] Scripts: deploy / seed / smoke / load / collect / destroy, with environment-tag guards.
- [ ] Budgets, TTL tag, per-replica connection-pool sizing doc (`replicas × pool ≤ DB max connections`).

### Phase 5 — One Azure validation window (S–M of work, ~1 day of cloud time)

Do this **only when phases 1–4 are finished**, because free credits are time-limited from account creation
(typically a month — verify). Eligible students may have a no-card credit instead.

- [ ] Create the account/subscription; set budget alerts first.
- [ ] Deploy staging from Bicep; run migrations; smoke tests; two replicas; cross-replica session and quota tests.
- [ ] k6 load (≤ ~200 VU is enough), observe scale-out, export App Insights metrics and the replica graph.
- [ ] Save the report (commit SHA, image digests, k6 script SHA, p50/p95/p99, error rate, replica counts).
- [ ] `az group delete`; record approximate cost.

### Phase 6 — Optional

- [ ] On-demand hosted demo (2.5).
- [ ] Entra ID sign-in; account lifecycle; operations runbook.
- [ ] ADR-013 (collaboration scale-out) and an Azure sandbox-runner design — as documents, not code.

---

## 7. What you may claim, and when

| Claim | Allowed after |
|---|---|
| "Enterprise-oriented architecture designed for Azure; Azure topology maintained as IaC" | Phase 4 |
| "Multi-replica Spring API with shared PostgreSQL-backed session and quota state" | Phase 1 (local two-instance test) |
| "Horizontal scaling validated on Azure Container Apps under synthetic load" | Phase 5, with saved evidence |
| "Provider-independent AI layer (deterministic / Azure Foundry / OpenAI-compatible)" | Phase 2 |
| "Grounding quality measured on an evaluation set" | Phase 3 |
| "Realtime collaboration scales horizontally" | **Never claim** until ADR-013 is implemented and load-tested; say "single writer today, documented scale-out path" |
| "Isolated execution on Azure" | **Never claim** until an Azure runner exists and passes the adversarial suite |

---

## 8. Decisions that are yours

1. **Hosted demo or not?** My recommendation is no standing server (2.5, option 1 or 2).
2. **Which free/cheap model** to use for real-AI demos — decide after the evaluation harness exists.
3. **Azure credit eligibility** (new-account credit vs student plan) — determines how much load testing fits.
4. **Entra ID sign-in** — worth it only if the target roles are Microsoft/Azure-centric.
5. **Data erasure policy** (ADR-014) — a product decision, not just an engineering one.

# Request correlation and metrics (RH-185 / RH-186)

Spring remains the modular monolith and the owner of authorization and durable queues. Python measures only its AI/data workloads. No collector, broker, log database, debugger UI, or cloud service is introduced. The design reference's internal AI debugger (screen 13, page 21) is a separate staff-only feature; these tasks supply its diagnostic foundation without exposing prompts or evidence through logs or metrics.

## Correlation contract

Every HTTP response, including security rejections, carries `X-Request-ID`. Both services accept one header whose value matches `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. Missing, malformed, oversized or repeated headers are replaced by a generated UUID. This is diagnostic metadata, never an authorization or idempotency key. A caller-supplied value can be reused and must not be treated as proof of identity.

Spring puts `requestId` into an MDC scope, restoring the prior context in `finally`. Async servlet redispatch uses the same ID. The research SSE executor explicitly captures the initiating request ID. UUID route variables add `sourceId` and `analysisId` while the request is running. Logs use route templates, not raw paths or query strings.

Migration V30 retains `request_id` on `processing_jobs` and `analysis_executions`. Enqueue captures the request ID; claims, retries and dispatcher restarts retain it. Initial duplicate enqueue returns the original job and correlation. Explicit reprocessing/execution creates a new job and captures the new request's correlation. Database triggers reject changes to correlation. Historical processing rows use their job ID; historical analysis rows keep their immutable payload and use their execution ID when the new column is null.

The source-ingest v4 body/result stays unchanged: `X-Request-ID` carries correlation as transport metadata. Spring sends it with the service credential on job, embedding, generation, authoring, source-analysis and planning calls. It never forwards browser credentials. The worker validates the header separately from its strict payload contracts. Its context is propagated into the provider/parser thread pool and reset after each request. Validated source jobs log `jobId`, `sourceId` and `attempt`; planning calls log `analysisId`. Spring execution logs bind `jobId` (the execution UUID) and `analysisId` to the durable request ID.

The body-level AI `requestId` used by the existing generation contract remains the immutable model-call identity. It is distinct from HTTP request correlation; model result/provenance and idempotency semantics are preserved.

## Structured logs and data minimization

Spring's Boot-provided Logstash JSON format includes MDC and SLF4J structured key/value fields. The worker emits JSON with timestamp, level, logger, event and an allowlist of diagnostic fields. Application events identify starts, completion, outcome, retries and safe error codes/types.

Do not add authorization headers, cookies, passwords, service/provider keys, signed blob URLs, filenames, files, prompts, retrieved chunks, generated code/results or provider response bodies. The worker formatter deliberately omits arbitrary message arguments, extras and exception messages/tracebacks. Backend ingest/source/API failure handlers record safe error codes/types rather than exception causes that can contain submitted values or signed URLs. Detailed immutable product provenance remains behind the existing workspace authorization; diagnostic logs are not a second evidence store.

## Local export and access

- Backend: `GET http://localhost:8080/actuator/prometheus`, `Authorization: Bearer $METRICS_SCRAPE_TOKEN`.
- Worker: `GET http://localhost:8090/metrics`, `Authorization: Bearer $AI_WORKER_SERVICE_TOKEN`.

The backend scrape uses a dedicated stateless security chain; browser sessions cannot access it. Only GET with an exact token of at least 32 characters succeeds. A blank token disables access (the cloud/test default); the local profile has an explicitly local development value. Set a real secret through environment configuration in a deployed environment. Worker metrics reuse its existing internal service credential. Both exporters return `Cache-Control: no-store`. Health probes remain public and `env`/`configprops` remain unexposed. No scrape token belongs in a `RESEARCHHUB_*` browser variable.

```sh
curl --fail --silent --show-error -H "Authorization: Bearer $METRICS_SCRAPE_TOKEN" http://localhost:8080/actuator/prometheus
curl --fail --silent --show-error -H "Authorization: Bearer $AI_WORKER_SERVICE_TOKEN" http://localhost:8090/metrics
```

## Metric contract

Spring metric names use Micrometer dot notation; Prometheus normalizes them to underscores and seconds. Counters gain `_total`, timers provide `_count`, `_sum`, `_max` and histogram `_bucket` series.

| Micrometer name / worker Prometheus name | Dimensions | Meaning |
| --- | --- | --- |
| `http.server.requests` | Framework method, route template, status/outcome, exception | Backend HTTP latency histogram and status counts; derive error rate from 5xx count / all requests. |
| `researchhub.jobs.queue` | `queue=SOURCE_INGEST\|ANALYSIS_EXECUTION`, closed `status` vocabulary | Counts of durable rows by status, including zero counts. Includes completed history, not just pending work. One aggregate query per queue every 5 seconds; snapshots may lag by that interval. |
| `researchhub.source.processing.duration` | `outcome=success\|failure` | Backend attempt time from dispatch through extraction, embedding, index persistence and publication; retries produce separate samples. |
| `researchhub.worker.failures` | Closed `queue` vocabulary | Failed backend source/execution attempts and recovered stale source attempts. |
| `researchhub.worker.retries` | Closed `queue`, `reason=FAILURE\|STALE` | Successfully requeued source attempts; terminal failures do not increment this counter. |
| `researchhub.ai.request.duration` | `outcome=success\|failure` | Backend AI/embedding/planning transport and response decoding duration, including failed calls. |
| `researchhub.analysis.execution.duration` | `outcome=success\|failure` | Reauthorized analysis attempt, input staging, isolated run, output validation and persistence. |
| `researchhub_worker_http_request_duration_seconds` | Route template / `UNKNOWN`, status | Worker HTTP duration and error counts; arbitrary unknown paths share one dimension. |
| `researchhub_worker_source_processing_duration_seconds` | `outcome` | Worker parsing attempts. Duplicate cached acknowledgements do not add a processing sample. |
| `researchhub_worker_failures_total` | None | Worker source processing failures, including safe failed parser results. |
| `researchhub_worker_ai_request_duration_seconds` | `outcome` | Actual worker AI/embedding provider calls; invalid/unauthorized requests are only HTTP samples. |

IDs, users, workspaces, models, filenames, prompts, URLs and exception messages never enter custom metric labels. Backend and worker timings represent different boundaries and must not be added as independent work. Retry counts live in Spring because it owns retry policy. Counters/timers are process-local and reset at restart; queue snapshots reconstruct from PostgreSQL. Crashed attempts are diagnosed by durable state, stale recovery counters and IDs; timers cover attempts that ran to completion in the process.

For example, backend HTTP error rate in PromQL is `sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) / sum(rate(http_server_requests_seconds_count[5m]))`; a route's p95 is `histogram_quantile(0.95, sum by (le, uri) (rate(http_server_requests_seconds_bucket[5m])))`.

## Later OpenTelemetry / Application Insights mapping

The exporter contract is vendor-neutral: dot/underscore metric names map to the same instruments, timers to duration histograms (seconds), counters to monotonic sums, and queue counts to gauges. An OpenTelemetry collector can scrape the two authenticated Prometheus endpoints and export to the chosen platform. `requestId`, `jobId`, `sourceId` and `analysisId` map to log attributes/custom dimensions, never metric dimensions. This change does not install a collector or claim that W3C distributed tracing / Application Insights is already configured. A future tracing adapter may attach trace/span IDs while retaining these durable application correlations.

## Verification

`cd backend && ./mvnw verify` builds the backend, runs PostgreSQL/HTTP/Python E2E tests and enforces 80% line and branch coverage for `shared.observability` as well as existing module gates. The ingest E2E test reads real worker JSON logs and backend log records, matches request/job/source IDs, checks durable correlation after reconstructing the queue adapter, validates exporter output/queue state, and rejects mutation of correlation.

`cd ai-worker && uv run --frozen pytest` tests safe JSON formatting, context isolation under concurrent requests, request ID validation, authenticated scraping, bounded route labels, success/failure metrics and duplicate delivery behavior. `scripts/check.sh` also enforces 80% branch-aware coverage for the observability module. The runtime remains Python 3.13.3 and the [official Prometheus Python client](https://pypi.org/project/prometheus-client/0.26.0/) is pinned in `pyproject.toml` and `uv.lock`.

Per-feature/model usage, versioned cost estimates and the protected RAG debugger are described in
[AI economics and RAG diagnostics](ai-diagnostics.md).

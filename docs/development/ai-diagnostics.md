# AI economics and RAG diagnostics (RH-187 / RH-188)

The existing Spring modular monolith owns workspace authorization, persistence and diagnostics. Python retains provider protocols and validation. No monitoring service, new runtime or public prompt endpoint is introduced. The debugger follows `design-reference/DESIGN_SPEC.md` screen 13 / Shell D: a staff header, request selector and three columns for configuration, retrieved evidence and context/answer inspection.

## Economic events

`V31` creates `ai_usage_events`, one finalized row per inference attempt/request UUID. All grounded generation, Ask Workspace, authoring (section drafting, rewriting and evidence matching), source analysis and computation planning record:

- correlation ID and generation request ID, feature, template ID/version and SHA-256;
- provider, model and deployment/model version where known;
- input/output tokens and the provider's `estimated` flag, where available;
- wall-clock model round trip in milliseconds (including worker retries/validation), outcome and safe error code;
- estimated USD cost and price-table version when a matching configured rate and valid usage exist.

The event never contains the user query, prompt, source text, provider output, credentials or unsafe error body. Costs are calculated with decimal arithmetic: `(inputTokens × inputUsdPerMillion + outputTokens × outputUsdPerMillion) / 1,000,000`. They are always estimates because the current provider contract contains no billing metadata. There are no speculative default rates. An unconfigured model, unavailable provider or invalid/missing usage produces `null`, rather than zero.

Foundry usage is captured before refusal and structured-output validation. Authenticated internal worker errors may add bounded `telemetry: {model, usage}` to the existing safe `code`; unknown/invalid fields are discarded by Spring. The additive internal error contract is exercised in both runtimes using `contracts/ai/telemetry/v1/provider-failure.json`. HTTP/network failures without usage stay unknown. Retry attempts without returned billing metadata cannot be charged accurately by this estimate. Successful deterministic fixtures mark token counts as estimates. Every computation planning attempt has its own request ID, so repair attempts remain individually comparable.

Aggregation groups by feature, provider, model/version, template and success/failure. `usageKnown`, `estimatedUsageRequests` and `costKnown` show incomplete coverage of totals; unknown rows are excluded from sums. An insufficient-evidence answer is a successful validated inference and still consumes tokens. A query with no retrieved evidence does not invoke the model and has a RAG trace without an economic event.

## Protected access and optional content capture

Default configuration disables the debugger, leaves the operator allowlist empty and disables private content capture. Workspace owners are not automatically operators. To inspect a local workspace, set backend-only values and restart Spring:

```dotenv
AI_DIAGNOSTICS_ENABLED=true
AI_DIAGNOSTICS_STAFF_IDS=<comma-separated registered user UUIDs>
AI_DIAGNOSTICS_CAPTURE_CONTENT=true
```

Both an allowlisted signed-in operator and current workspace content-reader permission are required for every endpoint. Non-operators, disabled deployments and unrelated workspaces return 404; anonymous requests return 401. Keep the flags false for public deployments. If deliberately enabled on a protected deployment, keep a narrow allowlist and existing HTTPS/session controls. No flag or allowlist belongs in a frontend environment variable.

Economic recording runs independently of these settings. Retrieval traces always retain safe stage metadata and chunk references. Only queries initiated by an allowlisted operator with content capture enabled retain the query and validated answer. The model's complete private prompt is never saved in diagnostics. Retrieved text is resolved on read through the source module's authorized, version-aware API, rather than copied into the trace. The chunk hash, workspace, source/version, processing version and provenance are checked. Missing/changed projections are displayed as unavailable. Turning content capture off immediately redacts stored queries/answers and prevents chunk text reads. Workspace membership is checked again after assembling a detail response.

Private RAG traces expire after seven days, with hourly cleanup. Economic metadata remains available for later comparisons. Trace reads list at most the newest 50 requests within the selected 1–90 day window. Cleanup runs with the existing Spring scheduler. No content is sent to logs or an external telemetry service.

## Local price configuration

Use backend YAML or equivalent Spring configuration. Rates must match the exact provider, model name and model version. Entries have unique identities, bounded nonnegative prices and an explicit rate-table version. This example intentionally uses zero for the offline fixture, which makes no billed model call:

```yaml
researchhub:
  ai:
    diagnostics:
      rates:
        - provider: deterministic
          model: extractive-fixture
          model-version: "1"
          version: offline-fixture-v1
          input-usd-per-million: 0
          output-usd-per-million: 0
```

For Foundry, supply your deployment's agreed prices and update `version` whenever the table changes. Existing events keep their recorded estimate and version.

## Explicit read contracts

All responses use `Cache-Control: private, no-store` and the normal authenticated browser session. No public cross-workspace aggregate is exposed.

- `GET /api/workspaces/{workspaceId}/devtools/ai?days=30` → `{days, contentCaptureEnabled, usage: Aggregate[], traces: TraceSummary[]}`.
- `GET /api/workspaces/{workspaceId}/devtools/ai/traces/{id}` → `{trace, usage, chunks, retrievalStrategy, reranking}`; an unknown/foreign/expired trace returns 404.
- Browser route: `/app/workspaces/{workspaceId}/devtools/ai?trace={optionalTraceId}`. It uses a standalone internal shell, outside ordinary workspace navigation.

Java records in `ai/observability/AiDiagnostics.java` and TypeScript interfaces in `features/devtools/devtoolsApi.ts` define the DTOs. A trace shows the private query when captured, source/computed-output selection, hybrid top-k, original rank, composite/vector/lexical scores, embedding identity, source/page/version metadata, context bindings/deduplicated references, context bytes and conservative token reservation, template hash/version, retrieval/model latency, usage/cost, final claims and structured source/computation citations. The current pipeline has no reranker: `reranking=NOT_APPLICABLE`. The conservative UTF-8 reservation includes instructions, framing and reserved completion tokens; it is not an exact tokenizer count or answer confidence.

The existing safe counters/timers remain scrapeable through the RH-185/186 metrics endpoints. Persistent per-feature/model aggregates can be exported from the protected JSON API and later mapped to Application Insights/OpenTelemetry without exporting private diagnostic content or adding workspace/user IDs as metric labels.

## Validation

```sh
cd frontend && npm ci && npm run build && npm run lint && npm run test:coverage
cd ../ai-worker && uv sync --frozen && ./scripts/check.sh && uv build
cd ../backend && ./mvnw verify
# Optional real Chrome E2E, after building frontend; Docker and the frozen worker environment required:
AI_DIAGNOSTICS_BROWSER_TESTS=true ./mvnw -Dtest=SourceExtractionEndToEndTest#productionDebuggerBrowserUsesRealWorkspaceEvidenceAndHasNoOverflowOrCspViolations test
```

Backend E2E uploads and processes a PDF through the actual Python HTTP worker, asks supported/weak questions, drafts a section, verifies the aggregate, injects a provider failure and inspects persisted completed stages. Tests cover operator/membership/workspace isolation, disabled capture redaction, unavailable source versions, revoked membership, retention and unknown costs. Browser E2E verifies production Webpack output under the enforcing CSP and checks 1600/1200/760/390px layouts. JaCoCo gates the diagnostics module at 80% lines/branches; Jest gates the devtools feature at 80% lines/branches/functions/statements; the worker's AI telemetry gate is 80%.

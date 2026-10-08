# Model gateway (RH-110)

RH-112's [workspace questions](workspace-questions.md) compose this gateway with authorized retrieval
and a separate server-owned `workspace-question:1` policy/parameters. The same provider/context/audit
boundary serves both use cases.

The centralized structured generation substrate is implemented. See [ADR-003](../adr/ADR-003-model-gateway.md)
and [schemas/fixtures](../../contracts/ai/v1/README.md). The frontend supplies a typed shared client and
safe renderer for feature callers. Workspace questions now use this boundary through RH-112;
chat/document-generation workflows remain separate backlog work. Citation links validate the
retrieval version on opening a source preview.

RH-111 now prepares bounded, locally keyed context before generation. The product gateway uses the
v2 request/template and adds an immutable context summary to the response; historical v1 outputs
remain readable. Packing, budgets and compatibility: [grounded-context.md](grounded-context.md).

## Public contract

Routes under `/api/workspaces/{workspaceId}/ai` require session identity and VIEW_CONTENT, including
viewer access. Responses are `private, no-store`; POST requires CSRF. Cross-workspace/non-member
reads return 404. Preview generation creates an operational audit, without editing documents;
the existing read guard also allows an archived workspace.

| Method/path | Contract |
| --- | --- |
| `GET /model` | `{provider,name,version,structuredOutput:true,streaming:false}` |
| `POST /generations` | `{instruction,evidence:[{sourceId,chunkId,processingVersion}]}` → `{result,evidence}` |
| `GET /generations/{requestId}` | Persisted successful response; incomplete/failed/missing calls return 404. |

The nonblank instruction has at most 4,000 Unicode characters. Up to 12 unique references resolve
to current READY chunks in the path workspace. Stale versions return 409; unavailable/unready chunks
return 404. Provenance is bounded to 1,024 source spans per request. Client model/template settings
cannot override feature configuration. Empty evidence is valid; the fake returns INSUFFICIENT_EVIDENCE.
Membership and context are rechecked after inference before publishing.

`result` carries schema/request/template identities, template hash, model/provider/version, provider
request ID, usage and `answer`. SUPPORTED contains bounded claims (`text`, `evidenceIds`);
INSUFFICIENT_EVIDENCE has no claims. Spring builds evidence snapshots with workspace/source/chunk IDs,
processing version, content hash, page range, section title and source spans. Since RH-130 `sourceVersionId` is the
immutable source version the chunk was derived from (null only for evidence minted before versioning). Runtime checks
prove traceability, not semantic entailment.

Internal `GET /internal/ai/model` and `POST /internal/ai/generate` require the worker service Bearer
token. Model input contains explicit bounded text, never DB access, blob URLs or tools. The generation
adapter is separate from parser downloading and embeddings. Streaming and cost aggregation are deferred.

## Provider and feature configuration

Spring uses the existing worker URL/token/30-second timeout. Feature settings live under
`researchhub.ai.features.grounded-response`: `template-id=grounded-response:2`, `temperature=0`,
`max-output-tokens=1024`. Environment overrides are `AI_GROUNDED_RESPONSE_TEMPERATURE` (0–2 or `none`
to omit) and `AI_GROUNDED_RESPONSE_MAX_OUTPUT_TOKENS` (16–8,192). Invalid settings/unknown templates
fail startup. New template text requires a new version and fixtures. The template is a classpath resource
in `backend/src/main/resources/ai/templates/` and its UTF-8 SHA-256 is recorded on every request.

`AI_WORKER_MODEL_PROVIDER=deterministic` is the offline default. It returns up to four short excerpts,
identifies itself as `deterministic/extractive-fixture/1` and marks usage estimated. It is a test fixture.

Set `AI_WORKER_MODEL_PROVIDER=foundry` with all settings below for a deployed model:

| Variable | Meaning |
| --- | --- |
| `FOUNDRY_ENDPOINT` | Azure OpenAI HTTPS origin such as `https://RESOURCE.openai.azure.com`; no path/query/credentials. |
| `FOUNDRY_API_KEY` | Worker-only secret from the environment/secret store. |
| `FOUNDRY_DEPLOYMENT` | Deployment supporting strict structured outputs. |
| `FOUNDRY_MODEL` | Exact model identifier returned by the deployment; mismatch fails closed. |
| `FOUNDRY_MODEL_VERSION` | Immutable model/deployment revision; disable automatic upgrades or update configuration explicitly. |

The adapter posts to `/openai/v1/chat/completions` with strict `json_schema`, `store=false`,
`stream=false`, no tools, and feature completion-token/temperature settings. Redirects are refused.
Use temperature `none` for a deployment that does not support it. Foundry usage comes from returned
prompt/completion/total token counts and is marked `estimated=false`. No SDK/package pin changes are needed.

The worker retries transient 408/429/500/502/503/504 and connection failures at most three times, with
0.2/0.4-second pauses and an 8-second request timeout. Spring does not retry generation. Usage is for
the successful final response; failed-attempt billing and pricing belong to later telemetry work.

## Audit and failures

V15 stores REQUESTED before inference with caller/workspace, feature/template identity/hash,
parameters, internal-request SHA-256 and bounded provenance. SUCCEEDED includes the complete response
before success is returned; FAILED stores a safe code. Remote calls run outside database transactions.
Persistence failure publishes no successful result. Process interruption may leave REQUESTED; there
is no automatic replay of billable calls. This table is a call audit, not conversation history.

The audit stores no raw user instruction, credential or provider error body. Successful claim text
is source-derived content protected by workspace authorization. Provenance snapshots survive
reprocessing; source preview links warn if the current retrieval version differs. Previews use the
current blob, not a historical copy. Every stored-response read checks current membership.

| Application code | HTTP | Meaning |
| --- | --- | --- |
| `AI_UNAVAILABLE` | 503 | Bounded transient retries exhausted. |
| `AI_PROVIDER_ERROR` | 502 | Permanent provider/protocol failure; details discarded. |
| `AI_OUTPUT_INVALID` | 502 | Invalid schema, identity, metadata, usage or citations. |
| `AI_REFUSED` | 422 | Provider refused/filtered output; no partial answer. |
| `AI_CONTEXT_TOO_LARGE` | 413 | Context reservation exceeded before calling the provider. |

## Verification

From `backend/`: `./mvnw verify` builds the jar and enforces separate JaCoCo 80% line gates for the
gateway and AI/source/processing. Docker and `ai-worker/.venv` from `uv sync --frozen` are required
for the real-worker E2E: PDF → chunks → model → audit, two workspaces, viewer/session/CSRF, stale/unready
evidence, saved-result isolation and safe errors.

From `ai-worker/`: `sh scripts/check.sh` runs pinned pytest with global 80% coverage followed by
`coverage report --include='src/researchhub_worker/ai/*' --fail-under=80`. Tests cover fake determinism,
Foundry wire format, retries, malformed/tool/refused output, usage, identity, citations and service auth.
Cloud contracts are tested without a paid cloud request.

From `frontend/`: `npm run test:coverage`, `npm run build`, `npm run lint`. The AI feature has an
80% lines/branches/functions/statements gate covering CSRF/scoping, codes, escaped claims and citations.

`docker compose build ai-worker` rebuilds the pinned runtime. Compose supplies provider settings;
inject cloud secrets outside Git and restart the worker after changing deployment. Current Spring
product persistence uses the local profile; the cloud profile remains a deployment scaffold.

Economic metadata is now recorded independently of private prompts for every model gateway call.
See [AI economics and RAG diagnostics](ai-diagnostics.md) for rates, unknown usage semantics,
provider failure metadata and the operator-only workspace debugger.

## OpenAI-compatible chat and embeddings (RH-318)

`OpenAiCompatibleModelProvider` implements the same model protocol as deterministic and Foundry.
Only its adapter knows the remote wire format; the Spring modular monolith still owns authorization,
feature templates, context, immutable provenance and the generation audit. `ModelGateway` evidence
and prompt-injection validation are unchanged. No database migration or package dependency is needed.

| Worker environment variable | Contract |
| --- | --- |
| `AI_WORKER_MODEL_PROVIDER` | `deterministic` (default), `foundry`, `openai-compatible` |
| `OPENAI_COMPAT_BASE_URL` | Required HTTPS API base. No userinfo, whitespace, query, fragment or path traversal. An origin gets `/v1`; an API prefix such as `/api/v1` or `/v1beta/openai` is preserved. |
| `OPENAI_COMPAT_API_KEY` | Required nonblank, whitespace-free worker secret; sent only as `Authorization: Bearer …`. |
| `OPENAI_COMPAT_MODEL` | Exact requested and returned model name; mismatch fails closed. |
| `OPENAI_COMPAT_MODEL_VERSION` | Required operator-pinned snapshot/deployment revision, recorded in provenance. Re-evaluate vendor aliases after changes. |
| `AI_WORKER_EMBEDDING_PROVIDER` | Independent selection: `deterministic` (default), `azure`, `openai-compatible`. |
| `OPENAI_COMPAT_EMBEDDING_MODEL` | Exact embedding model requested/returned when compatible embeddings are enabled. |
| `OPENAI_COMPAT_EMBEDDING_VERSION` | Required immutable vector-space/model revision. |
| `OPENAI_COMPAT_EMBEDDING_DIMENSION` | Required integer 1–4,096. Sent as `dimensions` and locally checked for every vector. |

Example for the user's preferred candidate (supply the secret through the worker environment):

```dotenv
AI_WORKER_MODEL_PROVIDER=openai-compatible
OPENAI_COMPAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
OPENAI_COMPAT_MODEL=gemini-3.8-flash
OPENAI_COMPAT_MODEL_VERSION=GA-2026-09-provider-alias
AI_WORKER_EMBEDDING_PROVIDER=deterministic
```

**All provider credentials belong exclusively to the worker.** Never put them in Spring, frontend
`RESEARCHHUB_*` variables, browser requests, Git, generated reports or container images. Main and
demo Compose forward these values only to the worker. Cloud production can continue selecting Foundry.

Chat uses `/chat/completions`, `stream:false`, `store:false`, no tools/functions and `max_tokens`
from the existing server parameter. Every attempt has an eight-second transport timeout, refuses
redirects and reads at most **256 KiB**. TLS certificate verification remains enabled. 408, 429 and
all 5xx map to `AI_UNAVAILABLE`; other HTTP errors are permanent `AI_PROVIDER_ERROR`. Usage is recorded
through `record_payload` before validation, with repair responses accumulated instead of undercounted.
Refusals, unexpected tools, incomplete responses and model-identity mismatches are never repaired.

The adapter first requests strict `json_schema`. Only 400/422 explicitly identifying an unsupported
`response_format`/`json_schema` permits a fallback to `json_object`. Generic 400s, authentication errors,
redirects and malformed-schema errors do not negotiate weaker behavior. JSON mode supplies the exact
trusted application schema and still validates against the existing local answer/authoring/source-
analysis/plan contracts and evidence references. A schema-invalid content response gets **at most
one repair**, using the original context and a fixed trusted formatting instruction. It never feeds
provider error text or the invalid response back as trusted instructions. Strict rejection + fallback
+ one repair is at most three HTTP attempts within that completion. Transient-only gateway retry is
preserved; a transient failure during repair cannot restart the repair budget in that worker call.
Malformed envelopes and responses over the byte/content cap immediately fail with `AI_OUTPUT_INVALID`.
The UI explains that the response could not be validated and offers explicit retry/rephrasing.

Compatible embeddings use `/embeddings`, Bearer authentication, eight-second timeout, no redirects
and the same 256 KiB cap. Batching and bounded transient retry use the existing wrapper. Model identity,
exact indices/count, configured dimension, finite and nonzero vectors are locally validated.
`retrieval_embedding_models` already stores `(provider, model, version, dimension)` under its hashed
`index_id`. Changing any value selects a distinct vector space. Existing vectors remain invisible
until sources are explicitly reprocessed; no silent mixing or automatic model swap occurs. If large
vectors exceed the response cap, reduce document batch size at the adapter boundary rather than
relaxing the cap. Supported endpoints must honor the requested model/dimension and security settings;
API-shape compatibility alone does not guarantee provider data-retention behavior.

The local HTTP fake tests exercise success, schema negotiation, one repair, invalid JSON, usage,
429/5xx, redirects, oversize responses and all feature contracts. Existing deterministic/Foundry
fixtures remain unchanged. Reproduction, measured selection, terms and limits:
[AI evaluation](ai-evaluation.md).

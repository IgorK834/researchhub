# Native Gemini startup and verification

Put only the key in the private, ignored root `.env`:

```dotenv
GEMINI_API_KEY=your-google-ai-studio-key
```

Run `scripts/demo/up.sh` from the repository root. Java 25, Node/npm, Python 3.13 and
a running local Docker Engine/Desktop are prerequisites. The helper builds the pinned worker
and scientific sandbox, seeds the synthetic RC demo using the deterministic fixture, switches
to native Gemini, explicitly reprocesses demo sources with Gemini embeddings, starts the
HTTPS UI at **https://localhost:8443**, and checks the real saved execution and closed registration.
Use the generated local editor accounts and trust `.demo/local/root.crt` in the browser.
The browser shows **Live model: gemini-3.8-flash**. Existing scientific results retain their
original model/code/input provenance; newly planned analyses use Gemini.

No OpenAI key or additional model variables are required. Empty provider selectors choose
native `gemini-3.8-flash` and `gemini-embedding-001` with 768 dimensions. Explicit old
`AI_WORKER_*_PROVIDER=deterministic` settings override auto-selection; remove them to use the key.
All optional variables/defaults are listed in [configuration](configuration.md#native-gemini-worker-provider).
The key goes only to the worker; neither the browser, Spring, sandbox nor built image receives it.

The adapter covers source/workspace questions, persisted research conversations and validated
SSE delivery, drafts, all six rewrite actions, evidence search and comment assistance,
source comparisons/disagreements, scientific planning, and questions on persisted computations.
Spring retains workspace authorization and immutable provenance. Generated code executes only
in the existing isolated Python sandbox after the plan is validated. AI proposals still require
the existing explicit acceptance before editing a document.

## Reproduce live verification

After startup, one command exercises the public API on a separate authored synthetic workspace:

```sh
python3 scripts/demo/ai-smoke.py --local-quota-window
```

It checks upload/index readiness, scoped answers/refusal, conversation history/idempotency/SSE,
draft acceptance and citations, six rewrite actions, evidence insertion, comment AI and receipts,
comparison/disagreement, model-generated code in the real sandbox, table/chart provenance,
original-input reproduction, and a question on the saved numeric result. The dataset has 65 rows,
exceeding the inspection preview; the independent expected last-row impedance is 260 ohms.
The flag temporarily restarts only the managed local demo backend with the same quota limits
and a one-minute window. A finally block restores the original settings, including on failure.
Without the flag, the strict demo quota is 10 AI calls per user per hour. The private stage report is `.demo/local/gemini-live-smoke.json`. Test documents/sources remain in
the **Native Gemini E2E** workspace. No provider key is read by this public API client.

The fixed 33-case model benchmark and two injection probes use one command:

```sh
python3 scripts/demo/evaluate-ai.py
```

Reports go to `.demo/local/evaluation/`. The helper uses the pinned local worker environment when
available, otherwise the existing demo worker container. Exit 1 means the preferred candidate is
unavailable or misses committed thresholds. The common benchmark retrieval index remains the fixed
fixture index; it is not a measurement of Gemini embeddings in production pgvector. Native pgvector
and feature wiring are covered by the Spring E2E test and the separate public API smoke.

## Measured quality and project limits

On 2026-10-09 the configured key generated structured answers and native 768-dimensional
query/document embeddings. The demo booted and reprocessed its synthetic corpus. The project
initially returned an exhausted **20/day** free-tier quota; the user then enabled billing,
and the full 33-case benchmark plus two injection probes completed without generation failures.
See the [measured native-v2 report](../evaluation/results/gemini-native-2026-10-09/models.md).
The preliminary interrupted v1 run is preserved in its `quota-limited-v1` subdirectory.

Citation membership, correct refusal, schema-valid output and injection pass are 100%; p95 is
about 3.5 seconds and mean cost is 0.001453 USD at the matrix's paid standard rates.
Curated grounding is 67.86% and correctness 81.82%, below the unchanged 90% thresholds. Some
failures are valid-looking paraphrases that conservative exact rules do not recognize; they
remain failed, without modifying gold rules or treating citation membership as semantic support.
The quality adoption gate remains **FAIL**, even though the native feature integration is usable.

[Repository validation](../evaluation/results/gemini-native-2026-10-09/validation.json) records
649 passing worker tests, 97.63% overall and 94.97% native-module branch-aware coverage,
Maven `verify`, 1,098 passing frontend tests and coverage gates, 36 demo-helper tests,
container builds/security and the browser smoke.

The live refusal test exposed a missing-value interpretation issue; native-v2 explicitly requires
`INSUFFICIENT_EVIDENCE` when the requested measurement is absent. The live rerun passed.
Google rejected the larger comparison schema with generic `INVALID_ARGUMENT`; the adapter makes
one JSON-mode fallback and validates the complete original application contract locally.

The real public-API feature scenario passed all 18 stages, including comparison/disagreement,
all rewrite actions, comment evidence acceptance, code generation, execution of all 65 input rows,
chart/table provenance, ORIGINAL reproduction and a cited answer on the computed result.
The [stage report](../evaluation/results/gemini-native-2026-10-09/live-features.json) records the
model identity, synthetic dataset hash and measured stage latencies. A valid structured model
response can still fail application rules; one repair is bounded and a remaining failure is
shown as `AI_OUTPUT_INVALID`. This is a handled provider outcome, not an automatic document edit.

Google project limits can prevent inference despite a valid key. Check the actual project's
RPM/TPM/RPD allowance in [AI Studio / rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
Public API clients accessible in Poland/EEA require Google's Paid Services under the
[Gemini API terms](https://ai.google.dev/gemini-api/terms). The public-demo pricing/terms review and
fixed acceptance thresholds are in [AI evaluation](ai-evaluation.md). No billing settings are changed
by this repository. The UI explains unavailable/exhausted service and invalid structured output.

Conversation history remains a persisted investigation, not model memory. SSE delivers the validated
answer after persistence. Scanned PDFs still return `OCR_REQUIRED`; Google search is not added as a
model tool, and external source discovery retains its separate existing search-provider configuration.
Diagnostics remain restricted to explicitly enabled staff; token usage is recorded, including thinking
and repair, and backend cost estimates require configured, versioned diagnostic prices.

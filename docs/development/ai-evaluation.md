# Demo model selection (RH-346)

The preferred hosted demo candidate is **Gemini 3.8 Flash**, as requested. It is **not approved for
adoption yet**: no Gemini worker key was available during the 2026-10-08 run. Foundry was also
unavailable. The default demo therefore remains the explicitly labeled deterministic fixture.
Its refusal and injection thresholds fail; it demonstrates the product workflow, not LLM quality.
No evaluated local candidate passes every threshold. Qwen3 4B is the stronger local alternative
for correct refusals and injection handling, but misses grounded-answer, correctness, citation
and output-validity thresholds. Gemma3 1B largely refuses answerable questions.

[Measured results table](../evaluation/results/demo-models/models.md) and
[machine-readable results](../evaluation/results/demo-models/models.json) contain the complete
threshold decisions. Raw per-case reports include citations, curated support checks, usage,
errors and latency. The README links this evidence rather than presenting an unmeasured winner.

## Reproduce the comparison

Install the repository's pinned Python 3.13.3 / uv 0.12.20 environment with `uv sync --frozen`
from `ai-worker/`. Optional local inference requires **Ollama 0.30.10**, OpenSSL and the two models:

```sh
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama pull gemma3:1b-it-qat
```

The committed [candidate matrix](../evaluation/models/demo-matrix.json) pins complete SHA-256
model digests, provider/model versions, USD prices and acceptance thresholds. Downloaded tags
must match those digests; the harness rejects drift. Start the local Ollama runtime, then rerun
all available candidates with this **one command from `ai-worker/`**:

```sh
uv run --frozen python scripts/evaluate-demo-models.py --output ../docs/evaluation/results/demo-models
```

It measures the deterministic provider and both real local models. Export `OPENAI_COMPAT_API_KEY`
into this worker process to also evaluate Gemini 3.8 Flash. Export the existing five `FOUNDRY_*`
settings to evaluate the Foundry deployment. Give Foundry its deployment-specific USD pricing in
the matrix; unavailable/unknown cost does not pass the cost gate. Credentials are neither read
from the frontend nor written into reports. A private `.env` is not executed or loaded implicitly.
**Exit 0** means the preferred candidate passes all thresholds; **exit 1** retains the reports
but blocks adoption. Missing keys produce `unavailable`, not invented metrics.

For hosted candidates without local Ollama, use the same runners directly:

```sh
uv run --frozen researchhub-evaluate models --matrix ../docs/evaluation/models/demo-matrix.json --output ../docs/evaluation/results/demo-models
```

Leave `RH_LOCAL_MODEL_KEY` unset to mark the local endpoints unavailable in this mode.
The helper's temporary localhost TLS bridge is evaluation tooling for the existing Ollama process.
It forwards the exact OpenAI-compatible body and response, keeps public CA verification for hosted
candidates, checks an evaluation-only Bearer token and disappears after the run. It does not modify
product infrastructure, translate answers or change the worker's mandatory HTTPS policy.

## Measurement contract

The unchanged RH-220–222 suite has **33 cases, eight files, two workspaces**, plus two questions
from the reviewed `contracts/ai/security/prompt-injection.json` fixture. Its packaged copy is
byte-for-byte tested against that contract. Each model sees identical retrieved evidence,
template, top-K=6, chunking, temperature=0 and max output=1,024. No gold answers enter the prompt.
The reports bind the suite, original corpus and security fixture hashes. See
[dataset/runner contracts](../evaluation/README.md) for the complete provenance and gold rules.

This comparison uses the explicitly labeled **offline fixture hybrid index**, with deterministic
embeddings. Recall is consequently the same across generation models. It does not establish
pgvector performance or semantic embedding superiority. The Spring E2E runner remains available
for authorized production retrieval, source/page/chunk provenance and immutable snapshot checks.
Embedding changes need a separate index experiment and source reprocessing.

Citation membership, curated statement support and correct facts are distinct signals. A grounded
answer must satisfy all three. Exact quoted passages or approved full-statement patterns are the
support rules; they conservatively mark unfamiliar paraphrases unsupported. They are not a general
semantic entailment proof. Failed generations count against output/correctness and citation scores;
empty refusals have no citations and never inflate the grounded-answer numerator. Refusal scores
cover all five unanswerable suite cases. Injection scores include the source-instruction suite
case and both adversarial contract questions, requiring correct safe behavior, not just a valid JSON.

Latency includes provider fallback, repair and failed attempts; p50/p95 use the nearest-rank rule.
Local model download/load warmup is excluded, and Ollama's actual 4,096-token context and GPU/runtime
snapshots are recorded. Token totals include both responses of schema repair and validated usage on
failures. Missing usage/cost stays unknown. Local inference has zero API-token charge, excluding
hardware/electricity. Gemini's matrix uses paid standard prices, not an assumed free entitlement.
Temperature=0 and pinned inputs support reproducible comparisons; hosted aliases and GPU inference
do not guarantee byte-identical generated text. `GA-2026-09-provider-alias` identifies the documented
Gemini release, not a provider-guaranteed immutable weight snapshot; re-evaluate after alias changes.

Acceptance requires source/span recall >=95%, cited-fragment membership 100%, grounded answers
>=90%, correctness >=90%, correct refusal 100%, validated output after bounded repair 100%,
injection pass 100%, p95 <=8 seconds and average API token cost <=USD 0.01 per observation.
These thresholds were specified before the final measurements; local failures were not hidden
by weakening them. Full values and every miss are retained in the results table.

## Hosted terms and limits checked 2026-10-08

Google lists `gemini-3.8-flash` as a generally available model with structured outputs, reachable
through `https://generativelanguage.googleapis.com/v1beta/openai`.
[Model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).

The current standard paid rate is **USD 0.75 / million input tokens and USD 3.75 / million output
(including thinking) through 2026-12-31**; published rates become USD 1.50 / USD 7.50 on 2027-01-01.
A free tier is listed, but entitlement and active RPM/TPM/RPD limits depend on the project and tier.
Check the actual project's AI Studio limit page before a demonstration; the documentation does not
guarantee a universal allowance or successful rate-limit increase.
[Pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

Google's API terms require **Paid Services when making an API client available to users in the EEA,
Switzerland or UK**. A public demo accessible in Poland therefore needs an active billing-backed
project, even if its measured token cost is small. The API also has age, region and permitted-use
conditions. Unpaid-service data may be used to improve Google's products outside the stated EEA/UK/
Swiss exception; this repository's evaluation corpus is authored synthetic data. `store:false` avoids
stored chat state but cannot override a vendor's retention terms.
[Gemini API additional terms](https://ai.google.dev/gemini-api/terms).

Local Qwen is Apache-2.0. Local Gemma is governed by Gemma terms, including use/distribution
conditions for hosted functionality. These runs make no hosted free-tier calls and incur no
hosted quota. Review applicable model notices before exposing either model publicly.
[Qwen model card/license](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507),
[Gemma terms](https://ai.google.dev/gemma/terms).

## Enable a measured provider in the existing demo

Bootstrap the seeded demo with `scripts/demo/up.sh` in its deterministic mode; the RC fixture and
load seeder deliberately require that provider. After a candidate has been measured and its misses
accepted, supply worker-only provider variables from
[model-gateway configuration](model-gateway.md#openai-compatible-chat-and-embeddings-rh-318), then
recreate only its existing worker:

```sh
docker compose --env-file .demo/local/demo.env -f infra/demo/compose.demo.yaml up -d --no-deps ai-worker
```

Exported provider settings override Compose's deterministic default. For Gemini, keep deterministic
embeddings until a separately measured compatible embedding model is explicitly configured.
The demo startup/seeding checks remain deterministic; provider switching happens after bootstrap.
No model has been silently promoted by this implementation.

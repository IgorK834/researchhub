# Textual and computed evidence (RH-156)

The question and conversation-send contracts add optional `selectedAnalysisOutputs`:
an array of at most six distinct `{analysisId, executionId, outputId}` references. Omitted means none.
`selectedSourceIds` retains its existing semantics: omitted/null means all authorized sources, [] means no
textual sources. Asking never runs code, replans or chooses a latest execution.

The Java gateway resolves successful persisted outputs and sends only their bounded structured data:
tables retain exact rows/columns, totalRows and an explicit truncation flag; text is saved output text;
charts supply saved validated metadata, not inferred numeric points. It does not supply raw Python output,
generated code, stdout/stderr or image bytes. A selected unavailable/failed output fails before inference.
Textual hits plus computed outputs are bounded to 12 evidence items.

The existing model request envelope remains 2.0; context builder 2.0 adds independent local labels:
`[S1]` for source excerpts and `[A1]` for saved analysis outputs. Computed blocks cannot use textReference.
Both Java and Python validate framing, hashes, budgets, keys and evidence mapping. Numeric experimental
values must come from supplied saved outputs. The versioned workspace-question:2 prompt forbids claiming
a calculation was performed, inferring absent/truncated values, or inventing agreement with theory.
Source-only historical builder 1.0 / workspace-question:1 audits remain readable.

Responses keep `citations` for cited source chunks and add `analysisCitations` for cited computed evidence.
The generation audit retains all `analysisEvidence`, with execution/hash/code/runtime/input-version metadata.
Flyway V24 stores that audit metadata and the exact selected analysis scope on conversation user messages.
Conversation idempotency includes the computed scope; retrying with changed inputs requires a new request ID.

React renders S/A as different references. S opens the existing source inspection/page path; A opens the exact
historical analysis details. No claim is a client-side calculation. Identity, authorization and citation scope are
enforced; semantic agreement and entailment still require evaluation of the configured production model.

`request.json`, `model-request.json` and `response.json` are shared Java/Python/TypeScript fixtures.

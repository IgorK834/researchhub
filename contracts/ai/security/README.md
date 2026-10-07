# Evidence-boundary regression fixture (RH-182)

`prompt-injection.json` includes source text and metadata impersonating system messages, forged
citations, workspace authorization and database/storage requests. The unrelated workspace canary
is test setup, never model context. It is deliberately synthetic and contains no real secret.

The Python evaluation inspects the actual Foundry wire envelope, evaluates deterministic extractive
behavior and rejects stubbed invalid citations, tool/function requests and inconsistent insufficiency.
Spring's `SourceExtractionEndToEndTest` uploads and indexes the hostile source through the real
Python worker, creates a separate workspace with canary content, checks source-grounded output and
insufficiency, and verifies forged source selections and an outsider are denied before inference.
Metadata impersonation is seeded into the source display name because source renaming has no public API.

The offline provider can quote hostile text as evidence. Quoting it does not grant permissions or
execute its instructions. These tests prove message framing, capability absence and server isolation;
they do not certify semantic resistance for every cloud model. A model/deployment change also needs
evaluation against its actual outputs and human assessment of entailment. No live cloud inference,
credentials or paid calls are required by CI.

`ai.safety.EVIDENCE_POLICY` is the immutable provider-owned boundary v1, applied to every Foundry
completion (generation, questions, authoring, source comparison and computation planning). Existing
server-owned feature IDs/hashes and citation provenance remain intact. The context framing reserve
includes the boundary and the fixed `evidenceTrust` label; its overhead is checked by the evaluation.

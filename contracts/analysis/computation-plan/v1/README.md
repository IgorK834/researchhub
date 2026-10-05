# Computation-plan v1

`request.schema.json`, `candidate.schema.json` and `plan.schema.json` are generated from the pinned worker Pydantic
models in `researchhub_worker.analysis.contracts`; tests check schema drift and Java/Python use the same fixtures.
See [computation-planning.md](../../../../docs/development/computation-planning.md) for API and lifecycle semantics.

The request carries a versioned/hashed generation policy, the original prompt and authorized bounded dataset
inspections. Column references use physical 1-based indices. Null input sheet/columns means unrestricted within the
provided inspection; unknown and omitted metadata is never invented. Plans include explicit machine-readable intent
and provenance independently of the code. Every step must use declared required columns and every output must name
declared input versions. No arbitrary input paths, URLs or execution capabilities occur in the intent schema.

The internal candidate envelope retains a bounded model JSON string so rejected candidates can be audited. A
candidate is not a validated plan. Spring strictly parses and validates it before `READY_TO_EXECUTE`; invalid output
may consume the remaining three-attempt budget. The code string is untrusted even in a structurally valid plan.
This contract neither authorizes nor performs execution; the isolated engine enforces filesystem/network/resource
controls independently of the plan's declarations. Its controlled manifest/result protocol is specified in
[execution/v1](../../execution/v1/README.md).

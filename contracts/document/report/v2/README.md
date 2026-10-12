# Frozen mathematical report v2

`report.schema.json` describes the persisted browser-independent snapshot consumed by Java renderers. `report.json` is a shared fixture including inline/block math and an immutable native solution receipt. Historical v1 snapshots remain readable.

Math contains the closed document AST, accessible text, original canonical notation, a bounded local PNG and an optional warning/verification reference. Only validated AST generates OMML or TeX. Unsupported legacy notation remains literal with a visible warning. PNG dimensions are capped at 1600 × 512 before allocation; AST limits remain 128 nodes/depth 12. Renderers neither fetch remote resources nor run a TeX engine.

Native provenance preserves analysis/execution/output/step/conversation identities, input/plan/candidate/runtime hashes, pinned image, precision and receipt. Arithmetic CHECKED and interpretation NOT_CHECKED are separate. Human captions remain literal text. Export admission freezes the revision and already saved result; rendering never calls AI or recalculates.

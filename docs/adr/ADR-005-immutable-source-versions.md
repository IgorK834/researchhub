# ADR-005: Immutable source versions

- Status: Accepted
- Date: 2026-10-01
- Tasks: RH-130, RH-131, RH-132

## Context

Analyses, comparisons and citations are only trustworthy if they can be reproduced from the bytes they were made from.
Until now a source was a single immutable upload, so replacing a spreadsheet meant a new, unrelated source and no way to
say "this is revision 2 of that dataset". A mutable "replace" would have been worse: it would silently change the bytes
under every existing analysis. Dataset inspection (a bounded preview for the browser and a planner) also needs a stable
thing to describe.

## Decision

Split the object in two. A **source** stays the stable workspace identity; every upload is an immutable
**source version** (`source_versions`, Flyway V19). Replacing a file adds the next version with a new blob key and makes it
the active one; the active file columns on `sources` remain, as a complete copy of one of that source's own versions, so
existing readers are unchanged. The database enforces immutability (a trigger refuses any change to a version's input and
any delete) and the projection (the source can only point at its own versions, and its file columns must equal that
version's).

Everything derived from bytes is attributed to a version: durable jobs are bound to the version they were created for,
the full extraction and the retrieval snapshot of every version are kept, and each analysis records the exact version ids
it consumed (`ai_source_analysis_sources`, plus the same facts in its immutable payload). Re-running an analysis uses the
original versions by default and the latest only when the caller explicitly selects `LATEST`, which creates a new
analysis.

The bounded dataset preview (`analysis` module, `GET .../analysis/datasets/{source}/versions/{version}/preview`) is a
projection of the extraction profile the worker already produced for that version. It never opens the file, so it cannot
run a formula or be made to parse an expensive workbook, and its caps are enforced by the API that owns the contract. The
Java projection and the Python reference implementation are verified against shared fixtures.

Chunk identity stays content-addressed and version-independent: the worker mints it before the server binds a chunk set to
a version, and it keeps every id issued before versioning (and every citation that stored one) valid. The version is
recorded beside the id.

## Alternatives

* **Mutable replace with history.** Cheaper, but a missed copy makes an analysis irreproducible, and "the old bytes are
  somewhere" is not an enforceable invariant. Rejected.
* **Version the source by content hash only.** Gives dedup but no ordering, no "latest", and no per-version lifecycle.
* **Put the version id inside the chunk id.** Cleaner in isolation, but it would invalidate every stored chunk id and
  citation, and require recomputing hashes in SQL during the migration. Rejected.
* **Compute the preview in the worker on demand.** Would add a synchronous worker dependency and a second place that
  parses user files on a request path.

## Consequences

Old versions and their blobs are kept indefinitely; a retention policy is a deliberate future change (see
[source-versions.md](../development/source-versions.md#retention)). A version carries its own copy of the extraction and
retrieval snapshot, which costs storage in exchange for reproducibility. Only the latest version is searchable. Replacing
requires a terminal state (`READY`/`FAILED`) so there is never a second version in flight.

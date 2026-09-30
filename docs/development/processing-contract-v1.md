# Source ingest contract v1

Historical contract. RH-090/RH-091/RH-093 use v2; see [Source extraction](source-extraction.md).
Deploy the backend and worker together when moving to v2.

RH-083/RH-084 define the authenticated boundary between the Spring modular monolith and the Python data worker.
The canonical, executable examples are:

- `contracts/processing/v1/source-ingest-request.json`
- `contracts/processing/v1/source-ingest-result-success.json`
- `contracts/processing/v1/source-ingest-result-failure.json`

Java serialization/deserialization tests and Python Pydantic tests read these same files. A contract change that is
not backward compatible creates a new directory and `schemaVersion`; it does not silently redefine v1.

## Request

`POST /internal/jobs/source-ingest` uses `Content-Type: application/json` and
`Authorization: Bearer <AI_WORKER_SERVICE_TOKEN>`. The request contains:

- `schemaVersion`, currently `1.0`;
- `jobId`, `workspaceId`, and `sourceId` resolved from the durable job and a workspace-scoped source lookup;
- closed `sourceType` (`PDF`, `DOCX`, `XLSX`, `CSV`, or `TXT`);
- `fileAccess`, a read-only SAS URL for exactly one blob plus its expiry;
- `requestedProcessingVersion`, currently `source-ingest-1`;
- `attempt`, bounded to 1–100.

The model is synchronous request/result: the HTTP response is the result, so v1 has no callback endpoint. Adding a
callback transport later requires explicit callback authentication and a versioned contract change.

The backend service token is transport identity, never JSON. Browser cookies, CSRF values, end-user Bearer tokens,
storage account keys, blob storage keys, and document bytes are forbidden from the payload. Pydantic rejects unknown
fields. Missing/invalid service credentials are rejected before the worker reads or parses the body.

## Result

Every result repeats `jobId`, `workspaceId`, and `sourceId`, and names the actual `processingVersion`. The worker
processor refuses a handler result with different identity; Spring checks it again before marking the durable job
successful. The result keeps these concerns separate:

- `extractionMetadata`: title/author/language, page and character counts, and optional input hash;
- `structure`: page and hierarchical section ranges;
- `chunks`: ordered text plus page/section and character-range provenance;
- `warnings`: bounded user-safe messages;
- `failure`: a bounded code and safe message, present for `FAILED` and absent for `SUCCEEDED`.

`duplicateDelivery` reports process-local redelivery. It does not change result identity or durable idempotency:
`jobId` remains the idempotency key, while a renewed SAS and incremented attempt are delivery details.

## Limits and failure behavior

Spring reads at most 4 MiB before deserializing a worker response and rejects more than 10,000 pages, 50,000
sections, 100,000 chunks, or 100 warnings. The worker applies the same collection limits before serializing. A
malformed, oversized, mismatched, or wrong-version result becomes the safe `WORKER_CONTRACT_ERROR`; detailed parse
or transport errors remain server logs. A structured worker failure contributes only its validated uppercase code
and 1–500 character safe message to retry/job state.

The internal shared token is the MVP credential. Local Compose has an explicit development-only value; every
deployed environment must inject a high-entropy `AI_WORKER_SERVICE_TOKEN` into Spring and the worker from secret
configuration. The Bearer header and signed URL are never logged. The transport is deliberately compatible with a
later replacement by Azure managed identity without changing product/browser authorization.

# Model gateway contract v1

The JSON schemas come from `researchhub_worker.ai.contracts.model_json_schema(by_alias=True)`.
Both runtimes consume the request/result examples in tests; Java also verifies the server-owned
template text/hash. Template changes add a new ID/version and fixtures; incompatible protocol
changes add a new contract version.

Spring constructs the internal request from authorized READY retrieval chunks. Input consists of
explicit text and evidence, without storage credentials, file URLs or tools. SHA-256 uses UTF-8.
The bounds are 12 unique chunks of at most 8,000 Unicode characters each, instructions at most
4,000 characters, a 512 KiB internal request and a 256 KiB provider response.

Runtime validation supplements the schemas with template/content hashes, request/template
identity, unique references, consistent status/claims, citations against supplied context and
`totalTokens = inputTokens + outputTokens`. SUPPORTED requires cited claims;
INSUFFICIENT_EVIDENCE requires no claims.

The public request contains `instruction` and `evidence` references (`sourceId`, `chunkId`,
`processingVersion`). The response wraps `result` and application-owned `evidence` provenance.
Spring derives caller/workspace identity from the session/path and owns feature parameters.
See [model-gateway.md](../../../docs/development/model-gateway.md).

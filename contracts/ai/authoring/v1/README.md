# Authoring result v1 / context request v2

Shared Java/Python draft and rewrite fixtures pin the internal authoring boundary. Requests use the
existing v2 escaped context envelope and server-owned `authoring-{draft,rewrite,evidence}:1` templates.
Results carry identity, model, usage and an answer with status, plain text, actual retrieved chunk IDs,
and categorized evidence matches. They do not carry document writes. Production inference uses local
citation keys which the worker resolves; the server independently checks the resulting chunk allowlist.

`AuthoringContractTest` and `test_shared_authoring_fixtures` consume these files. Public document-scoped
HTTP fields, approval transactions and source/citation semantics: `docs/development/ai-authoring.md`.

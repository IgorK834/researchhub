# Workspace question v1 fixtures

`request.json`, `response.json` and `no-evidence.json` describe the public authenticated workspace
question contract. Workspace identity is supplied by `/api/workspaces/{workspaceId}/ai/questions`.
Selected IDs are optional; null/omitted means all scoped sources, [] means none.

`model-request.json` is an existing v2 contextual request with the immutable
`workspace-question:1` system template. `model-result.json` uses the existing v1 structured result
with chunk IDs translated from local keys. Java and Python tests read these fixtures; React tests
render the public response and follow real source/version/page links. Do not modify an existing
template version to change its policy. See [workspace-questions.md](../../../../docs/development/workspace-questions.md).

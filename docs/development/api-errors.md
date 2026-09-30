# API errors

REST failures use one JSON shape, [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `ProblemDetail`, with a stable `code`. The frontend branches on `code`, not on a Java class name.

Responses use `Content-Type: application/problem+json`.

Module placement and dependency rules: [backend-architecture.md](backend-architecture.md). DTO validation rules, shared length limits, and the trim policy: [validation.md](validation.md).

## Body

```json
{
  "type": "about:blank",
  "title": "Not found",
  "status": 404,
  "detail": "Workspace was not found",
  "code": "RESOURCE_NOT_FOUND"
}
```

| Field | Meaning |
| --- | --- |
| `type` | Always `about:blank` for now. Clients do not switch on this value. |
| `title` | Stable short label for the status. |
| `status` | HTTP status code. |
| `detail` | Human-readable explanation safe to show. |
| `code` | Stable machine code from the table below. |
| `errors` | Present only for validation failures. |
| `currentRevision` | Present only on the `CONFLICT` for a stale document revision. The stored revision, as a number. |

Validation adds field details:

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request validation failed",
  "code": "VALIDATION_FAILED",
  "errors": [
    { "field": "name", "message": "must not be blank" }
  ]
}
```

`errors[].field` is the request field name. `errors[].message` is the constraint message. The rejected value is not echoed.

A document save based on a revision that is no longer stored adds `currentRevision`:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "This document was changed by somebody else. It is now at revision 2, and your copy is at revision 1. Reload it and apply your changes again.",
  "code": "CONFLICT",
  "currentRevision": 2
}
```

`currentRevision` is the revision the server holds after refusing the write, which the write did not change. The
body does not include the stored content: the client reloads the document with the ordinary `GET` when the user
chooses to, and until then keeps what the user typed. Still `CONFLICT`, not a separate code — a client that only
reads `code` and `detail` handles it correctly.

Only a stale revision carries it. An archived document and an archived workspace also answer `409 CONFLICT`, but
without `currentRevision`: neither is a newer revision of the same edit, and reloading would not let the save
succeed. A client must treat the member as optional and fall back to `detail` when it is absent.

## Codes

| `code` | HTTP | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Bean validation failed. `errors` lists the fields. |
| `MALFORMED_REQUEST` | 400 | The body could not be read, including invalid JSON. |
| `UNAUTHENTICATED` | 401 | No authenticated caller. |
| `FORBIDDEN` | 403 | The caller is known and is not allowed to perform the action. |
| `RESOURCE_NOT_FOUND` | 404 | The resource does not exist, or the route does not. |
| `CONFLICT` | 409 | The request collided with existing state: the write lost an optimistic concurrency check, it would duplicate a unique value, or the resource's current state does not allow it. Registering an email that already has an account is this code, including when the address differs only by letter case or surrounding space. Editing an archived workspace is also this code, and so is demoting or removing a workspace's last owner. |
| `PAYLOAD_TOO_LARGE` | 413 | The upload exceeds the configured limit: the multipart limit, the per-source limit (`researchhub.sources.max-size-bytes`), or a workspace quota. The detail names the limit. |
| `UNSUPPORTED_FILE_TYPE` | 415 | The product does not accept this file type: the extension is not supported, the declared media type contradicts it, or the content does not match it. The detail lists the supported types; see [sources.md](sources.md#types). |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | The HTTP `Content-Type` is not accepted. |
| `INTERNAL_ERROR` | 500 | Unexpected failure. |
| `AI_UNAVAILABLE` | 503 | Model temporarily unavailable after bounded retries. |
| `AI_PROVIDER_ERROR` | 502 | Provider failure; unsafe details discarded. |
| `AI_OUTPUT_INVALID` | 502 | Invalid structured response, identity, metadata, usage or citations. |
| `AI_REFUSED` | 422 | Model refused/filtered a request; no partial response. |
| `AI_CONTEXT_TOO_LARGE` | 413 | Selected evidence exceeds the server context budget; no model call is made. |

`detail` for `INTERNAL_ERROR` is always `An unexpected error occurred`. The server log has the stack trace. The body does not include the exception class name, the exception message, or the stack trace.

## How modules raise these errors

Throw a type from `dev.researchhub.shared.error`:

- `ResourceNotFoundException`
- `UnauthenticatedException`
- `ForbiddenException`
- `ConflictException`
- `UnsupportedFileTypeException`
- `PayloadTooLargeException`

The message becomes `detail` and must be safe for a client. Do not put secrets, SQL, or class names in that message.

When a client needs a fact it should not have to parse out of `detail`, a module subclasses one of these and
passes named properties to the protected constructor. `GlobalExceptionHandler` writes each one into the body next
to `code`; the standard members and `code` and `errors` are reserved and refused. Every such property is part of
the contract and is listed in the table above. Today there is one: `currentRevision`, from the `document`
module's `StaleRevisionException`.

`dev.researchhub.shared.api.GlobalExceptionHandler` maps those types, Bean Validation, unreadable bodies, upload size, and unsupported media types. Unexpected exceptions become `INTERNAL_ERROR`.

## Security filters use the same shape

Spring Security is on the classpath. Most `401` and `403` responses are still application exceptions thrown by a handler and mapped by `GlobalExceptionHandler`, but a request can also be rejected inside the filter chain, before any controller runs. That path cannot reach `@RestControllerAdvice`, so the `auth` module writes the same body itself:

| Component | Answers | With |
| --- | --- | --- |
| `ProblemDetailAuthenticationEntryPoint` | A request to a protected route with no usable session | `401` `UNAUTHENTICATED` |
| `ProblemDetailAccessDeniedHandler` | A denied request, in practice a missing or stale CSRF token | `403` `FORBIDDEN` |

Both go through `ProblemDetailErrorWriter`, so there is exactly one error contract on the wire. A client never has to parse a second shape depending on how far into the stack the request got.

**CSRF is checked before authentication.** A mutating request with no CSRF token is `403 FORBIDDEN` whether or not the caller has a session, and only a request that passes CSRF can go on to be answered `401 UNAUTHENTICATED`. So `POST /api/auth/logout` with no token is `403`, while the same call with a token but no session is `401`. The order is deliberate: a request that may have been forged by another site should not be processed far enough to reveal whether it would have authenticated. A client that sends the `X-XSRF-TOKEN` header, as `shared/api` does, only ever sees the `401`.

### 409 versus 403 versus 404

These three answer different questions, and mixing them up either leaks information or misdescribes the
failure. The workspace routes are the worked example:

| Caller | Answer | Why |
| --- | --- | --- |
| Not a member | `404 RESOURCE_NOT_FOUND` | Whether the workspace exists is itself information only its members get. The detail is identical to a workspace id that does not exist, so an id cannot be probed. This applies to the member routes too: the roster is inside the boundary. |
| A member whose role is too low | `403 FORBIDDEN` | They already know the workspace exists, so hiding it would tell them nothing and would describe the wrong problem. Their role is the problem. |
| An owner editing an archived workspace | `409 CONFLICT` | Not an authorization failure — the caller may hold every capability there is. The request collides with the workspace's state. |
| An owner adding an email with no active account | `404 RESOURCE_NOT_FOUND` | One detail, `No registered user has that email`, for an unknown address, a malformed one, and a disabled account alike. Distinguishing them would turn adding a member into a way to discover which addresses are registered. |
| An owner adding somebody who is already a member | `409 CONFLICT` | Collides with existing state, and is caught both by a pre-check and by `uq_workspace_members_workspace_user`, so a race ends the same way. |
| An owner demoting or removing the last owner | `409 CONFLICT` | The workspace would become unmanageable. The detail says to promote somebody else first. |
| An editor saving — or restoring a version of — a document whose stored revision has moved on | `409 CONFLICT` | Somebody else saved first. The write is refused rather than applied, because overwriting them silently is the one outcome nobody can recover from. The detail names both revisions, and `currentRevision` carries the stored one, so the client can explain it. |
| An editor saving an archived document, or any write in an archived workspace | `409 CONFLICT` | Collides with the state of the thing being written, not with the caller's permissions. |

A request that reaches a document through the wrong workspace is `404`, not `403` — see the first row. That
holds for the read, the save, and the archive, and it holds even when the caller is a member of both
workspaces.

The order the server checks them in is part of the contract: authorization first, state second. A non-member
must never receive the `409`, because that would confirm both that the workspace exists and that it is
archived.

Login failures are deliberately uniform: an unknown email, a wrong password, and a disabled or locked account all return `401` `UNAUTHENTICATED` with detail `Invalid email or password`. Distinguishing them would turn the login form into an account-enumeration oracle. An unknown email is never `404`.

Authentication mechanics: [../adr/ADR-001-authentication.md](../adr/ADR-001-authentication.md).

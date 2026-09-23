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

## Codes

| `code` | HTTP | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Bean validation failed. `errors` lists the fields. |
| `MALFORMED_REQUEST` | 400 | The body could not be read, including invalid JSON. |
| `UNAUTHENTICATED` | 401 | No authenticated caller. |
| `FORBIDDEN` | 403 | The caller is known and is not allowed to perform the action. |
| `RESOURCE_NOT_FOUND` | 404 | The resource does not exist, or the route does not. |
| `CONFLICT` | 409 | The request collided with existing state: the write lost an optimistic concurrency check, it would duplicate a unique value, or the resource's current state does not allow it. Registering an email that already has an account is this code, including when the address differs only by letter case or surrounding space. Editing an archived workspace is also this code, and so is demoting or removing a workspace's last owner. |
| `PAYLOAD_TOO_LARGE` | 413 | The upload exceeds the configured limit. |
| `UNSUPPORTED_FILE_TYPE` | 415 | The product does not accept this file type. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | The HTTP `Content-Type` is not accepted. |
| `INTERNAL_ERROR` | 500 | Unexpected failure. |

`detail` for `INTERNAL_ERROR` is always `An unexpected error occurred`. The server log has the stack trace. The body does not include the exception class name, the exception message, or the stack trace.

## How modules raise these errors

Throw a type from `dev.researchhub.shared.error`:

- `ResourceNotFoundException`
- `UnauthenticatedException`
- `ForbiddenException`
- `ConflictException`
- `UnsupportedFileTypeException`

The message becomes `detail` and must be safe for a client. Do not put secrets, SQL, or class names in that message.

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
| Not a member | `404 RESOURCE_NOT_FOUND` | Whether the workspace exists is itself information only its members get. The detail is identical to a workspace id that does not exist, so an id cannot be probed. |
| A member whose role is too low | `403 FORBIDDEN` | They already know the workspace exists, so hiding it would tell them nothing and would describe the wrong problem. Their role is the problem. |
| An owner editing an archived workspace | `409 CONFLICT` | Not an authorization failure — the caller may hold every capability there is. The request collides with the workspace's state. |

The order the server checks them in is part of the contract: authorization first, state second. A non-member
must never receive the `409`, because that would confirm both that the workspace exists and that it is
archived.

Login failures are deliberately uniform: an unknown email, a wrong password, and a disabled or locked account all return `401` `UNAUTHENTICATED` with detail `Invalid email or password`. Distinguishing them would turn the login form into an account-enumeration oracle. An unknown email is never `404`.

Authentication mechanics: [../adr/ADR-001-authentication.md](../adr/ADR-001-authentication.md).

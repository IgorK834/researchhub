# Account lifecycle (RH-333, RH-334, RH-335)

The Spring modular monolith owns invitations, account credentials, verification and session revocation.
Flyway V45 adds `workspace_invitation`, hashed account action tokens, append-only account audit events,
shared security operation budgets and `users.email_verified_at`. Hibernate validates the schema.
The `user.application.AccountSecurityService` is the public boundary for account mutations and verified
identity reads; workspace code never imports the user persistence layer.

## Invitations

| Method and path | Body / response | Authorization |
| --- | --- | --- |
| `POST /api/workspaces/{id}/invitations` | `{email, role}` → 201 `{invitation, invitationPath}` | `MANAGE_MEMBERS`, active workspace |
| `GET /api/workspaces/{id}/invitations` | Invitation metadata including status timestamps; no token/hash | `MANAGE_MEMBERS` |
| `DELETE /api/workspaces/{id}/invitations?invitationId={uuid}` | 204; idempotent revocation | `MANAGE_MEMBERS`, active workspace |
| `DELETE /api/workspaces/{id}/invitations/{invitationId}` | Equivalent item route used by the SPA | Same |
| `POST /api/invitations/{token}/accept` | 200 `{workspaceId}` | Signed-in, active user with matching normalized **verified** email |

Foreign workspace and invitation IDs return `404 RESOURCE_NOT_FOUND`. A member without the capability
gets `403 FORBIDDEN`. The invited role must fit within the inviter's capabilities. The current role
model permits only owners to manage invitations, including invitations to another owner.
The inviter must still hold the necessary authority when a link is used for registration or acceptance.
An existing member is not silently promoted by accepting another invitation.

Tokens contain 32 bytes from `SecureRandom`, encoded as 43 URL-safe Base64 characters. Only SHA-256
hashes are persisted. The seven-day lifetime is measured with the application Clock. Acceptance locks
the invitation and workspace, then inserts membership, marks acceptance and appends the audit event
in one transaction. Concurrent attempts cannot both succeed. Used, revoked, expired, malformed and
unknown links return `400 VALIDATION_FAILED`; an unverified account gets `403 FORBIDDEN`.

The members page displays the copyable link once, following creation. List responses cannot recover it.
The link carries the secret in a URL fragment, so it does not enter page request URLs or referrers.
Only the explicitly required acceptance API uses the token in its path; ProblemDetail instances redact
that segment, request logging uses route templates, and Application Insights masks the corresponding
URL attributes. Do not enable raw request/access logging in a proxy for this route.

In `invite-only` mode, registration accepts optional `invitationToken` in addition to `email`, `password`
and `displayName`. Invitation validation and account creation share a transaction. Registration leaves
the token available until the newly registered user signs in, verifies their email and accepts it.
`disabled` mode continues to reject all registration. Normalization is the existing trim/lowercase email
policy. Legacy accounts are initially unverified; they can sign in and request verification.

Workspace audit events: `INVITATION_CREATED`, `INVITATION_ACCEPTED`, `INVITATION_REVOKED`, with invitation
ID, actor and role. No email, secret or hash is placed in audit metadata.

## Account settings and sessions

| Method and path | Body / response |
| --- | --- |
| `POST /api/auth/password` | `{currentPassword, newPassword}` → 204 |
| `GET /api/auth/sessions` | Array `{handle, createdAt, lastAccessedAt, userAgent, current}` |
| `DELETE /api/auth/sessions/{handle}` | 204, including revoking the current browser |
| `POST /api/auth/sessions/revoke-all` | 204; signs out all browsers including the caller |

All routes require the caller's active account. Session lookup always uses
`FindByIndexNameSessionRepository.findByPrincipalName(callerId)`. Handles are independent random
256-bit values stored as session attributes. Raw session IDs remain server-side and are never included
in DTOs or audit/log data. User agent summaries contain only a recognized browser and platform, rather
than the submitted header. Historical sessions receive opaque handles on their first listing.

Password changes apply the existing `PasswordPolicy` and BCrypt encoder, invalidate every other session
immediately through the PostgreSQL repository, and invalidate outstanding reset links. The current
session is preserved. Revoking the current session or all sessions also clears the HTTP security context.
Account audit events: `PASSWORD_CHANGED`, `SESSION_REVOKED`, `SESSIONS_REVOKED`, `SESSIONS_VIEWED`.

Local, demo and Azure product profiles default to JDBC sessions. `AUTH_SESSION_STORE=servlet` remains
an explicit legacy selection; session management/reset fail closed with a standard `409 CONFLICT`
when the indexed shared repository is unavailable. Account settings are reachable at `/app/account`.

## Reset and verification

| Method and path | Body / response | Authorization |
| --- | --- | --- |
| `POST /api/auth/password-reset/request` | `{email}` → 202 fixed message | Public |
| `POST /api/auth/password-reset/complete` | `{token, newPassword}` → 204 | Public; single-use token |
| `GET /api/auth/email-verification` | `{emailVerifiedAt}` | Signed-in user |
| `POST /api/auth/email-verification/request` | 202 | Signed-in user |
| `POST /api/auth/email-verification/complete` | `{token}` → 204 | Signed-in user with matching email |

Reset tokens expire after 30 minutes; verification tokens expire after 24 hours. Both use the same
256-bit random generation and SHA-256 persistence rule. A reset invalidates all sessions and all other
outstanding reset links. Verification never changes account access until the token is redeemed.
`PASSWORD_RESET` and `EMAIL_VERIFIED` are appended to the account audit table.

For every syntactically valid reset request, the synchronous path performs identical operations:
consume IP/email budgets, create a hashed token and publish an in-memory event. **No account existence
lookup or mail transport runs on the response thread.** After transaction commit, asynchronous delivery
looks up the account and sends only when it is eligible. Thus account existence does not control response
body or synchronous workload, including on SMTP failures. Mail failures log only event/purpose, never the
exception, message or action link. Templates contain display name, purpose and link; no workspace data.

Every mutating endpoint, including public registration/reset, uses the existing CSRF cookie/header
contract. The sensitive `GET /api/auth/sessions` additionally requires the same CSRF header and records
a session-list audit event. Other safe GET reads use the normal Spring Security CSRF convention. PostgreSQL rate budgets are
shared across backend replicas and charged in a separate transaction, including unsuccessful attempts:
10/hour for invitation creation, password changes, reset requests/completions and verification
requests/completions; 60/hour shared across session listing/revocation. Reset requests charge both
remote IP and normalized email, independent of whether an account exists. Budget keys contain only
hashes. Rejections use `RATE_LIMIT_EXCEEDED` with `Retry-After` and `retryAfterSeconds`.

## Mail runtime configuration

`MailSender` is an account-only application port. `LoggingMailSender` is selected for `local` and `demo`,
with an explicit exclusion of `azure` and `cloud`. It prints action links for development. The Azure
adapter uses BOM-managed `spring-boot-starter-mail`/`JavaMailSender`, STARTTLS, five-second transport
timeouts and forced disabled mail debug logging. SMTP exception content is never written to application
logs. Azure requires an HTTPS public URL; mail configuration is mandatory at startup.

| Variable | Azure | Local/demo |
| --- | --- | --- |
| `SMTP_HOST` | Required SMTP host | Unused |
| `SMTP_PORT` | Defaults to 587 | Unused |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | SMTP credentials | Unused |
| `SMTP_FROM` | Required sender address | Unused |
| `PUBLIC_BASE_URL` | Required HTTPS frontend origin | Defaults to `http://localhost:3000` / `https://localhost:8443` |

No email service, external queue or additional deployment service is required for local development.
If a deployment's SMTP server uses a different authentication policy, set the standard Spring Mail
properties explicitly. Public base URLs are configuration values, never derived from a request Host header.

## Validation

`AccountLifecycleIntegrationTest` runs two real backend instances sharing one Testcontainers PostgreSQL
and the actual logging mail adapter. It covers invite-only registration → verification → acceptance,
foreign workspace/account isolation, wrong/expired/revoked/used tokens, concurrent redemption,
shared rate budgets, CSRF and cross-instance session invalidation. Unit tests cover account mutations,
legacy handles, agent summaries, SMTP/production logging exclusions and identical reset request workload.
The historical V21 upgrade test includes the V45 schema and re-authenticates after recreating session tables.

Run `cd backend && ./mvnw verify` and `cd frontend && npm run build && npm run lint && npm run test:coverage`.
JaCoCo and Jest enforce at least 80% coverage for the new modules. Frontend component tests cover loading,
empty, error, success, copy failure, confirmation and logout states.

For production-bundle browser E2E, start two local backend instances against an **isolated** PostgreSQL:
one with registration `open` for owner bootstrap and one with `invite-only`. Set their public mail base URL
to `http://127.0.0.1:3113` and their worker base URL to `http://127.0.0.1:18190`.
The test owns a metadata-only worker fixture on that port so the existing public runtime config
can load; it does not run inference. Build the frontend, then run:

```sh
cd frontend
E2E_BACKEND_URL=http://localhost:18081 \
E2E_BOOTSTRAP_URL=http://localhost:18080 \
E2E_MAIL_LOG=/tmp/researchhub-account-e2e.log \
node e2e/account-lifecycle.cjs
```

The browser test serves `dist/` through a local test proxy, creates its own workspace, registers through
an invitation, verifies email using the logging adapter, accepts with `EDITOR` role, changes/reset passwords,
checks other browser sessions are anonymous and signs out all sessions. A screenshot is saved to
`frontend/test-results/account-lifecycle/account-settings.png`.

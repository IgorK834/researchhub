# ADR-009: Shared session and quota state in PostgreSQL

- Status: Accepted
- Date: 2026-10-08
- Tasks: RH-349, RH-307, RH-308, RH-309, RH-310, RH-311, RH-312, RH-314

## Context

A stateless Spring replica must recognize the browser session created by another replica and enforce the
same costly-operation limits. Servlet sessions and in-memory counters are useful local adapters, but lose
state on restart and multiply effective limits during scale-out. ResearchHub already requires PostgreSQL
for its modular monolith. Workspace authorization remains a server decision on each request; credentials
must not embed stale membership or account status.

## Decision

Keep [ADR-001's session authentication](ADR-001-authentication.md): an opaque `JSESSIONID` credential in an
HttpOnly/Secure cookie, CSRF token cookie/header, session-ID rotation at login and invalidation at logout.
Use Spring Session JDBC for `demo`, `azure` and the one-release `cloud` alias. Flyway V36 owns session and
attribute tables; `initialize-schema=never` disables Spring's independent schema writer. Store the security
context with a string user UUID, null credentials and no workspace authorities. Resolve the current account
and membership through product services, preserving revocation semantics across replicas. Compatible sessions
survive process replacement. Switching an existing servlet deployment to JDBC requires a fresh login.

Use `PostgresCostQuotaStore` (Flyway V37) for shared user/workspace admission counters. Each admission performs
bounded conditional `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE request_count < limit RETURNING ...`
operations in a single READ COMMITTED transaction, always user scope before workspace scope. PostgreSQL row
locking serializes competing admissions. If either scope is exhausted, roll back both increments, so denied
work cannot partly consume another scope. Retry only serialization/deadlock failures, with a bounded attempt
count. The admission transaction is REQUIRES_NEW: later business failure still consumes an admitted request,
matching the previous memory adapter. Windows use an injected UTC clock, and cleanup only deletes expired
history. Denials keep the existing 429/Retry-After contract after authentication and workspace authorization.

Profiles select these adapters; product services and interceptors remain unconditional. Azure cannot silently
select memory. There is one datasource shared with domain persistence and scheduled work. Sessions and quota
admission add database traffic and must be counted in the [replica connection budget](../development/persistence.md#connection-budget-and-autoscaling-rh-314).

## Consequences

No sticky sessions, new cache service or secondary authorization mechanism is required. Database availability
now determines session access and admission: failures propagate rather than granting unlimited work. Account
and membership changes are checked using current state; quota windows require synchronized replica clocks.
JDK session serialization assumes compatible Spring Security class formats and trusted database contents.
Each replica runs bounded cleanup; release planning must retain serialization compatibility or require login.
Quota counters are operational retention data, separate from immutable research provenance.

Connection caps, active/pending/timeout metrics and session/cleanup capacity must be considered before scaling.
PostgreSQL remains a shared failure domain; backup and restore include both product and shared state.

## Alternatives considered

- **JWT instead of sessions:** introduces client credential lifetime/revocation and refresh-token handling without
  removing server workspace checks. Keeping the settled browser contract avoids changing auth behavior.
- **Redis sessions/counters:** strong fit at higher throughput, but adds another stateful service, operational
  lifecycle and failure policy. PostgreSQL already provides durable shared state and atomic multi-scope admission.
- **Sticky routing or replica-local counters:** cannot preserve global limits or restart-safe authentication.
- **Independent user/workspace increments:** can oversubscribe or leave partial charges after a denial; rejected.

## Implementation and verification

- [JDBC session guard](../../backend/src/main/java/dev/researchhub/auth/infrastructure/JdbcSessionStoreConfiguration.java),
  [session lifecycle](../../backend/src/main/java/dev/researchhub/auth/infrastructure/BrowserSession.java),
  [auto-configuration selection](../../backend/src/main/java/dev/researchhub/auth/infrastructure/SessionStoreAutoConfigurationFilter.java).
- [PostgreSQL quota adapter](../../backend/src/main/java/dev/researchhub/security/infrastructure/PostgresCostQuotaStore.java),
  [adapter selection and admission](../../backend/src/main/java/dev/researchhub/security/infrastructure/CostQuotaConfiguration.java),
  [quota migration V37](../../backend/src/main/resources/db/migration/V37__create_cost_quota_bucket.sql).
- [Cross-replica session tests](../../backend/src/test/java/dev/researchhub/auth/api/SharedJdbcSessionIntegrationTest.java),
  [quota contract](../../backend/src/test/java/dev/researchhub/security/infrastructure/PostgresCostQuotaStoreContractTest.java),
  [concurrency](../../backend/src/test/java/dev/researchhub/security/infrastructure/PostgresCostQuotaConcurrencyTest.java),
  [retry/rollback](../../backend/src/test/java/dev/researchhub/security/infrastructure/PostgresCostQuotaRetryTest.java),
  [two-instance HTTP limits](../../backend/src/test/java/dev/researchhub/security/api/PostgresCostQuotaHttpIntegrationTest.java),
  [Azure startup and adapters](../../backend/src/test/java/dev/researchhub/AzureProfileStartupIntegrationTest.java).

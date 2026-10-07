# Health

Actuator health for local checks and a future orchestrator. `health` and authenticated `prometheus` scraping are exposed on the web. See [observability.md](observability.md) for the dedicated scrape token. `/actuator/env`, `/actuator/configprops`, and the other Actuator endpoints are not public. `management.endpoint.health.show-details` is `never`, so responses are a status and do not include the JDBC URL, username, password, or validation query.

## URLs

The application listens on port 8080 unless that is changed.

| URL | Role |
| --- | --- |
| `GET /actuator/health` | Aggregate status. On the local profile this includes the database contributor `db`. |
| `GET /actuator/health/liveness` | Process only (`livenessState`). It does not check the database. |
| `GET /actuator/health/readiness` | Ready to receive traffic. On the local profile this is `readinessState` and `db`. |

`UP` is HTTP 200. `DOWN` and `OUT_OF_SERVICE` are HTTP 503.

With Compose Postgres running:

```bash
docker compose up -d postgres
cd backend
./mvnw spring-boot:run
```

```bash
curl -sS http://localhost:8080/actuator/health
curl -sS http://localhost:8080/actuator/health/readiness
curl -sS http://localhost:8080/actuator/health/liveness
```

While the process and the database are up, readiness and liveness return `{"status":"UP"}`. The aggregate adds the probe group names and no connection details:

```json
{"groups":["liveness","readiness"],"status":"UP"}
```

## Database down after startup

If Postgres stops or refuses connections after the process has started:

- `/actuator/health/readiness` is HTTP 503 and `{"status":"DOWN"}`.
- `/actuator/health` follows `db` and is also not `UP`.
- `/actuator/health/liveness` stays HTTP 200 and `UP`. The process is still alive. An orchestrator should stop sending traffic, not treat the process as dead, only because the database is down.

## Database down at startup

On the local profile, a wrong host, port, or password still fails startup through HikariCP before HTTP is served. There is no health response in that case. See [persistence.md](persistence.md).

## Profiles without a datasource

The `test` and `cloud` profiles exclude JDBC auto-configuration, so they have no `db` contributor. Readiness includes `db` only in `application-local.yaml`, where a datasource exists. Cloud readiness will include `db` when a later task maps `DB_URL` to `spring.datasource`. It does not do that now.

# Configuration

How ResearchHub separates local development, automated tests, and a future cloud deployment. Follow this document instead of inventing a new place for secrets.

Security rules in [docs/context.md](../context.md) still apply, including “Never commit secrets” (section 32).

## Profiles

| Profile | When it is used | Secrets |
| --- | --- | --- |
| `local` | Developer machine. This is the default when no profile is set. | Not in Git. Use environment variables when a later task needs a secret. |
| `test` | `./mvnw test` and other automated tests. | None. Tests must start on a clean machine. |
| `cloud` | A deployed environment, later. | A managed store such as Azure Key Vault. Not wired up yet. |

Shared non-secret defaults live in `backend/src/main/resources/application.yaml`. Each profile adds `application-local.yaml`, `application-test.yaml`, or `application-cloud.yaml` next to that file. Files use the `.yaml` extension.

`BackendApplication` activates `local` when the process does not already name a profile. A normal `./mvnw spring-boot:run` therefore uses `local`. Setting `spring.profiles.default` in `application.yaml` does not change which profile Spring Boot selects, so the default lives in `main` instead. `@SpringBootTest` does not call `main`; tests opt into `test` with `@ActiveProfiles`.

## Activate a profile

Use one of these. An explicit profile replaces the default.

Environment variable:

```bash
SPRING_PROFILES_ACTIVE=local
```

Maven:

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

IntelliJ: open the monorepo root, run `BackendApplication`, and set **Active profiles** to `local`, `test`, or `cloud`. The same field can be left empty for day-to-day work because the default is `local`.

## Defaults and secrets

| Kind of value | Where it goes |
| --- | --- |
| Non-secret default | `application.yaml` or the matching `application-<profile>.yaml` |
| Local secret | Process environment variable. Do not commit it. |
| Cloud secret | Managed secret store, later. The cloud profile only names what must be present. |

`.env` and `.env.*` are gitignored. `.env.example` is the tracked list of names. Spring Boot reads the process environment. It does not read a `.env` file unless a later task adds that on purpose.

Do not add a second local secrets file pattern. If a value is secret, it is an environment variable documented in this file.

## Local workflow

From `backend/`:

```bash
./mvnw spring-boot:run
```

That command uses the `local` profile. `application-local.yaml` contains no passwords, keys, or connection strings.

When a later task needs something like a database URL on your machine, export it in the shell or set it on the IntelliJ run configuration. Copy names from `.env.example` if you keep a private `.env` for your own tools. Do not commit that private file.

## Test profile

`BackendApplicationTests` is annotated with `@ActiveProfiles("test")`. It loads `application-test.yaml` and does not load the cloud profile.

The test profile has no database, object storage, or API credentials. `./mvnw test` must pass without `DB_URL`, `BLOB_ENDPOINT`, or any other secret in the environment.

## Cloud profile

The cloud profile is a placeholder for deployment. It does not provision Azure or any other host.

Startup fails when a mandatory value is missing or blank. The current mandatory variables are:

| Variable | Purpose |
| --- | --- |
| `DB_URL` | JDBC URL for the primary database |
| `BLOB_ENDPOINT` | Object storage endpoint for source binaries |

`application-cloud.yaml` maps those variables with no default. `CloudEnvironmentProperties` rejects a blank value. Add further mandatory cloud settings to this table and to that properties class in the same change. Do not introduce a one-off secret name in a feature task.

Check the failure locally:

```bash
cd backend
SPRING_PROFILES_ACTIVE=cloud ./mvnw spring-boot:run \
  -Dspring-boot.run.jvmArguments="-Dspring.devtools.restart.enabled=false" \
  -Dspring-boot.run.arguments="--spring.main.web-application-type=none"
```

Maven exits with code 1. The log contains `DB_URL must be set when the cloud profile is active`. The process does not keep serving HTTP. Devtools restart is disabled in this command so a failed start is not reported as a successful Maven build.

Cloud hosts are expected to inject the same variable names from a managed secret store. Azure Key Vault is the likely store later. This repository does not connect to it yet.

## Frontend

Public build-time values use the prefix `RESEARCHHUB_`. When the Webpack build is wired, pass them through `DefinePlugin` or an equivalent env plugin. Anything with that prefix can end up in the browser bundle.

Never put backend or Azure secrets in frontend configuration. `DB_URL`, `BLOB_ENDPOINT`, storage keys, and API credentials are not `RESEARCHHUB_*` variables.

A later public value can look like `RESEARCHHUB_API_BASE_URL`. No frontend variable is read today. `frontend/src` is still empty, and there is no Webpack config.

## Names for later

Environment variables use uppercase snake case. Concrete variables are added here when a task starts reading them. Examples already reserved for the cloud profile: `DB_URL`, `BLOB_ENDPOINT`.

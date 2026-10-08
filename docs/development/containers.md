# Production container artifacts (RH-192)

Java 25 / Spring Boot 4.1.1 remains a modular monolith. Python model adapters and computations
stay in the worker and isolated sandbox. These images are deployment artifacts; normal coding
still uses host Maven, npm and the existing dependency-only Compose stack.

## Build and runtime contracts

Run from the repository root:

```bash
docker build -t researchhub-backend:demo backend
docker build -f frontend/Dockerfile -t researchhub-frontend:demo .
docker build -t researchhub-ai-worker:demo ai-worker
docker build -t researchhub-sandbox:1.1.1 sandbox
python3 scripts/demo/verify-images.py
```

| Artifact | Build stage | Runtime | Health |
| --- | --- | --- | --- |
| Backend | Temurin JDK 25.0.2, Maven wrapper, Spring Boot BOM | Temurin JRE 25.0.2, UID 10001; executable JAR only | Java probe checks public Actuator readiness; target platform uses HTTP liveness/readiness |
| Frontend | Node 26.9.0; `npm ci` consumes the committed lock, typecheck and production Webpack | Caddy 2.11.2, UID 10001; static assets only | `/healthz` checks static hosting; API readiness is separate |
| AI worker | Python 3.13.3; uv 0.12.20, frozen production dependencies, installed wheel | Same pinned Python, UID 10001; virtualenv only, no uv/build environment | `/health`; environment supplies service token, model/embedding adapters and parser limits |
| Sandbox | Pinned Python 3.13.3 and existing scientific requirements lock | UID 65532, unchanged runtime 1.1.1 | One-shot execution; process exit and validated result manifest; no daemon health check |

Each FROM uses an exact version **and manifest digest**. Update both together, rebuild all affected
images, run their existing tests and image acceptance, and review the repository security scan.
Multi-architecture upstream manifests permit native arm64 laptop builds and amd64 CI/deployment.
This change does not introduce image publishing or Azure provisioning.

Backend/worker environment values are runtime configuration. Use the
[profile contract](configuration.md), including the complete Azure requirements; production uses
Flyway and Hibernate validation. No database or worker credential is a build argument.
Build contexts use allowlists and exclude local environment files, credential material, output,
dependency folders and VCS metadata. Maven/npm cache mounts are build-only and are not copied to
runtime images. CI gates image acceptance together with independent component quality checks; skipping tests within
the Docker packaging stage does not replace `mvn verify`, pytest or frontend checks.

The backend JVM reserves at most 70% of the container memory for its heap and exits on OOM.
The demo runs with read-only roots, dropped capabilities, bounded memory/PIDs and disposable
tmpfs directories. It never mounts the Docker socket into backend/worker containers.
Caddy's upstream low-port file capability is removed: these images listen on 8080 and work with
`cap_drop: ALL`.

## Static frontend deployment

Production may upload `frontend/dist/` to static hosting behind a trusted HTTPS ingress.
No long-running Node process is needed. The Caddy image is a portable static-hosting option for
local verification or platforms expecting a container. Its only runtime routing setting is
`API_UPSTREAM` (default `backend:8080`); browser public values remain build-time configuration.

The default browser API base is same-origin. Route `/api/*` and `/actuator/*` to the backend and
use SPA fallback for client routes. Hashed assets may be cached immutably; HTML needs revalidation.
The image imports the existing Webpack `security-headers.json` policy, including CSP frame
ancestors, nosniff and referrer policy. HTTPS/HSTS belongs at the trusted TLS ingress; the local
container serves HTTP and does not claim to provide TLS. Follow
[browser deployment security](browser-and-ai-security.md) when configuring an external static host.

CI builds all four artifacts, checks their non-root/secret-free configuration, runs static SPA
routing/security/health, creates the RC fixture with a real host-backed sandbox, then runs shared
state and smoke checks. Its evidence artifact contains summaries and resource metrics, never the
private seed credential files. See [CI](ci.md), [demo](../../scripts/demo/README.md) and
[performance](../../performance/README.md).

# Browser and evidence boundaries — RH-182 / RH-183

ResearchHub remains a Spring modular monolith (Java 25, Spring Boot 4.1.1/BOM) with Python AI/data
adapters outside the core domain. No new database migration, tool execution capability or hosting
service is introduced. RH-111 context packing and the ADR-001 session boundary are the implementation
dependencies. The design references require visible AI scope, traceable source/execution citations,
explicit insufficiency and user-approved suggestions; those product behaviors remain unchanged.

## AI evidence boundary

The server selects the feature template and curated evidence after workspace authorization. Source
text, titles, section labels, document text, dataset previews and analysis outputs are untrusted data.
Context keys `[S1]` / `[A1]` are created by the application; metadata/text lives inside escaped JSON.
Python's `ai.safety` appends a fixed trusted system policy and labels the user payload
`evidenceTrust: UNTRUSTED_EVIDENCE`. Source values cannot supply message roles or override this label.
The computation execution protocol is a JSON field, so sample strings cannot break its framing.

The model has no database/storage credentials, retrieval handle or tools/functions. Structured output
cannot invent citation identities or request a tool call; those responses fail closed without retries.
Spring also verifies that every retrieval row matches the workspace, source, chunk and processing
version requested. It rechecks membership and evidence after inference before publishing the result.
The application assembles provenance from stored source/execution records, never model-supplied IDs.

Evaluation: [fixture and limits](../../contracts/ai/security/README.md). The fixture covers injection,
unrelated workspace canaries, missing evidence and forged scope. Semantic entailment remains a model
evaluation and human review concern; the application does not claim an LLM can never be persuaded.

## Cookies and CORS

| Effective environment | Session and CSRF cookies | CORS default | HSTS |
| --- | --- | --- | --- |
| local | Secure=false, SameSite=Lax | `http://localhost:3000` only | disabled, including local HTTPS |
| test | Secure=false, SameSite=Lax | no cross-origin access | disabled |
| cloud | Secure=true, SameSite=Lax by default | no cross-origin access | one year, only for an HTTPS request |

Session cookies always use HttpOnly. The CSRF cookie remains readable and carries the same Secure /
SameSite policy; mutating requests still require the CSRF header. Cloud supports `lax`, `strict` and
`none` through `SESSION_COOKIE_SAME_SITE`. Insecure cookies outside local/test, SameSite=None without
Secure and disabling HttpOnly fail startup, including direct servlet-property overrides.

`CORS_ALLOWED_ORIGINS` accepts exact HTTPS origins, with HTTP loopback permitted in local/test only.
No wildcard/pattern, opaque `null` origin, userinfo, path, query or fragment is allowed. Credentialed
requests allow the existing API methods and CSRF header; `Retry-After` is exposed for quota feedback.
The preferred browser topology remains one origin with `/api` forwarded at the edge and frontend
`credentials: same-origin`. CORS and SameSite=None alone do not turn the current frontend into a
cross-site authentication client: its cookie-reading CSRF transport would need an explicit separate
contract. SameSite=Lax is suitable for the default same-origin topology.

Forwarded headers are untrusted by default (`server.forward-headers-strategy=none`). With HTTPS
terminated at an edge, either emit HSTS there or explicitly configure Boot's native handling with
the trusted proxy addresses and ensure the backend cannot be reached outside that edge. Never enable
forwarded handling on a publicly reachable backend without that trust restriction. HSTS does not
include subdomains or preload. The cloud profile remains the existing deployment scaffold; it does
not wire a cloud database or expose local-profile business services.

If the edge changes the host or scheme while forwarded-header handling remains disabled, Spring
may see the browser's public origin as cross-origin even with `/api` on the same public host. Set
`CORS_ALLOWED_ORIGINS=https://research.example.com` to the exact SPA origin and preserve the browser's
`Origin` header, or configure trusted native forwarding as above so Spring reconstructs the public
origin. An empty allowlist works when Spring sees the same public origin as the browser.

## Frontend response-header contract

Production Webpack emits external hashed CSS/JS and `dist/security-headers.json`. Build the cloud
artifact with `RESEARCHHUB_DEPLOYMENT_ENV=cloud npm run build`; local verification uses the default
`local`. The deployment serving **the SPA HTML**, including client-route fallbacks and error pages,
must apply every entry in `headers`. Apply `httpsOnlyHeaders` only for HTTPS in the cloud deployment.
The backend's API headers cannot secure an HTML response served by another host.

The contract enforces `script-src 'self'`, denies inline handlers/eval, frames, embedding, objects,
workers and base URL changes, and sets nosniff, DENY and a referrer policy. `connect-src` permits self
plus exact configured API and `RESEARCHHUB_CSP_CONNECT_ORIGINS` origins; configure an exact WSS origin
when collaboration is enabled. Cloud builds reject non-HTTPS/WSS connections. Blob images allow
saved analysis charts. No remote font/CDN or wildcard connection is required.

`style-src 'self'` requires external stylesheets. Tiptap's automatic style-element injection is
disabled and its MIT-licensed baseline is shipped as CSS. The narrow `style-src-attr 'unsafe-inline'`
exception permits React progress sizing and ProseMirror caret/table positioning; it does not permit
style elements or scripts. A meta CSP is also emitted as a fallback; frame-ancestors and the other
HTTP headers must still be applied by the host. Development Webpack retains its existing style-loader
and eval-based tooling; it must not be used as the public deployment server.

Header behavior follows [Spring Security](https://docs.spring.io/spring-security/reference/servlet/exploits/headers.html)
and the [CSP response-header contract](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy).

## Verification

`.github/workflows/security.yml` pins third-party actions to verified commits, grants read-only
repository access and runs the locked worker, frontend coverage/build/lint/runtime audit and Spring
verify with the real browser security test. It uses the existing scientific sandbox for computation
E2E. Module gates require at least 80%: JaCoCo security lines/branches (including auth's filter-chain
adapter) and AI lines, worker AI and
evidence boundary, and frontend CSP lines/branches/functions/statements.

Local commands:

```sh
cd ai-worker
./scripts/check.sh
cd ../frontend
npm run lint
npm run test:coverage -- --runInBand
npm run build
npm audit --omit=dev --audit-level=high
cd ../backend
SECURITY_BROWSER_TESTS=true ./mvnw verify
```

Docker, the existing `researchhub-sandbox:1.1.1` image, the locked worker environment and Chrome (or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`) are required for E2E. The browser test covers login/session flags,
document editor styling under enforcing CSP, upload rejection, quota feedback, preserved inputs
and blocked inline script execution. Cloud cookie/header tests cover actual servlet Set-Cookie
attributes and HTTPS/HTTP behavior. Backend tests use isolated PostgreSQL containers.

Compatible lockfile updates remove the patched shell-quote command-injection and source-map-js
denial-of-service versions. The production-only npm audit reports no vulnerabilities at verification.
Development-tool advisories can remain upstream (including braces with no patched release); they
are not shipped as a public server. See the [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv),
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Do not force-downgrade Webpack to
an obsolete major merely to satisfy npm's suggested development dependency remediation.

# Repository hygiene and dependency scanning — RH-184

`ResearchHub CI` owns builds, component tests and application coverage. The RH-182/RH-183 security
workflow owns browser/prompt-injection regressions and calls the reusable `Repository security`
workflow for repository checks on pull requests, pushes to main/master, weekly rescans of the
default branch and manual runs. It does not add a service, change workspace authorization or give
scanners application credentials. Required branch checks and path selection are documented in
[ci.md](ci.md); workflow YAML does not itself configure GitHub branch protection.

## Findings policy

| Check | Fails CI | Warnings / reporting |
| --- | --- | --- |
| Tracked file hygiene | `.env`, `.env.*` other than `.env.example`; private-key/credential containers, common credential filenames and Terraform state | No filename exceptions for credential material; use synthetic fixtures or public `.crt` certificates |
| Gitleaks | Any secret finding in full fetched Git history or tracked working files; shallow history; scanner errors | Redacted logs/JSON only; the exact public `tokenPolicy` identifiers `utf8-conservative-v1` and `utf8-conservative-v2` are excluded from the generic-key rule |
| Runtime dependency scan | Every HIGH/CRITICAL finding, including findings with no available fix | LOW/MEDIUM/UNKNOWN findings remain visible warnings |
| Development dependency scan | Scanner failures or incomplete inventories still fail | All dev-only findings, including HIGH/CRITICAL, are warnings and must be reviewed; this is not an assertion that CI tooling is safe |
| Optional container scan | HIGH/CRITICAL OS or language-package findings, including unfixed findings; scanner/build failures | Opt-in manual security job; not run during ordinary PR checks |
| Check implementation tests | Test failures or coverage below 80% | Coverage includes branch execution; real Gitleaks integration runs after installing pinned tools |

Warnings are emitted as Actions annotations and preserved in the JSON reports. There is no blanket
vulnerability allowlist, `ignore-unfixed`, `continue-on-error` or baseline that hides old secrets.
Unavailable databases, malformed scanner results, missing inventories, unresolved versions and a
missing package result for any expected inventory fail closed. Reports are retained for seven days,
including failed runs. Cancelled jobs may not complete scans or upload reports.

The initial verified scan after the security updates reports zero runtime findings and seven
development findings. These include pytest/Vitest/sprintf-js MEDIUM advisories, braces HIGH with
no fixed version, and two CRITICAL tinypool advisories in collaboration test tooling. Dev warnings
are intentionally separate from runtime gates; maintainers should review their applicability and
upgrade the affected test toolchain. Do not expose test/dev servers publicly or pass production
secrets to them. Vulnerability databases can change this count without a repository change.

## Inventories and reproducibility

`scripts/security/check.py` discovers tracked Maven POMs, npm projects and Python dependency
inventories rather than scanning generated output or local environment files. npm projects require
a sibling `package-lock.json`; Python projects require `uv.lock`, `requirements.lock` or
`requirements.txt`. A new unsupported package manager needs an explicit adapter and tests before
its dependencies can be considered covered.

Current inventories are:

- `backend/pom.xml`: Maven parent/BOM and transitive compile/runtime dependencies, resolved by Trivy.
- `frontend/package-lock.json` and `collaboration/package-lock.json`: runtime plus separate dev scan.
- `ai-worker/uv.lock`: runtime plus separate dev scan.
- `sandbox/requirements.lock`: all pinned scientific runtime packages, copied byte-for-byte as
  `sandbox/requirements.txt` in an ephemeral scanner directory because that is Trivy's supported
  pip filename. The committed lockfile and runtime installation path are unchanged.

Trivy's Maven POM analyzer excludes test/provided/optional scopes and build plugins. Its dev flag
adds npm/uv dev dependencies, not those excluded Maven scopes. This scope limitation is explicit;
the check does not claim a Maven plugin or test-tool audit. See the supported
[Maven](https://trivy.dev/docs/latest/coverage/language/java/),
[npm](https://trivy.dev/docs/latest/coverage/language/nodejs/) and
[Python](https://trivy.dev/docs/latest/coverage/language/python/) analyzers.

Java remains version 25 and Spring Boot remains 4.1.1. The Boot BOM still manages ordinary
dependencies. Three temporary security properties override its vulnerable versions: Jackson 2 BOM
2.22.3, Jackson 3 BOM 3.2.3 and Tomcat 11.0.25. Both Jackson BOMs must remain aligned because
Jackson 3 also uses `com.fasterxml.jackson.annotation`; mixing the older annotations with the new
mapper fails startup. Remove these exceptions when the agreed Boot baseline supplies equivalent
fixes. Maven versions are not individually scattered through application dependencies.

pypdf is pinned at 6.19.0 and the parser provenance reports `pypdf-6.19.0/rh-1`. Pillow 12.3.0 and
fonttools 4.60.2 remove the scientific-runtime findings. The sandbox is now version/image **1.1.1**,
so new executions record the patched runtime. Existing persisted parser/runtime identities and
historical contract examples remain valid; original reruns still select their saved immutable image
digest/version and never silently substitute the new image. Retain old images only where needed
for explicitly requested reproduction; they are not cleared by this change.

## Secret handling and GitHub capabilities

`.gitignore` prevents ordinary addition of environment/private-key files. The tracked-file check
also catches files added with `git add -f` or committed before an ignore rule existed. `.env.example`
is allowed by filename but is still scanned for secrets. Local ignored `.env` files are not read,
copied or uploaded. Gitleaks scans all fetched refs and the current tracked working files. Its
configuration extends upstream rules and has only the exact policy-identifier exception; genuine
tokens in a `tokenPolicy` field still fail the real-scanner integration test.

Use GitHub Secret Scanning and Push Protection wherever the repository plan supports them. In
repository Settings → Security / Advanced Security, enable those controls, generic patterns where
available and notifications for repository owners. GitHub's feature availability depends on
visibility, ownership and plan; see [GitHub Secret Scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning).
On 2026-10-07 the API reported `Secret scanning is not available for this repository` for the current
private user-owned repository, so it could not be enabled. The portable Gitleaks gate does not
depend on a paid GitHub feature or a Gitleaks action license. Recheck availability when moving the
repository to a supported organization/plan or making it public. The workflow's token only has
`contents: read`; it cannot enable repository settings or dismiss native GitHub alerts.

For a genuine finding, revoke/rotate the credential first, remove it from the current tree and
review history cleanup with the repository owner. Do not print the credential in an issue/log or
add a broad path exception. A false-positive exception must be narrowly scoped to the matched
non-secret value and covered by a positive secret-detection test.

## Local checks and optional images

The installer supports Linux x86_64 and macOS arm64, pins Trivy 0.75.0 / Gitleaks 8.30.1 and verifies
upstream archive SHA-256 values before extracting the executables. Actions are pinned to commit
SHAs, checkout has `persist-credentials: false`, and no `pull_request_target` execution is used.
Tool versions and checksums should be reviewed together when upgrading scanners.

From the repository root (Python 3.13.3, uv 0.12.20, Git, curl, network access):

```sh
sh scripts/security/install-tools.sh /tmp/researchhub-security-tools
uv sync --project ai-worker --frozen
mkdir -p security-reports
GITLEAKS_EXECUTABLE=/tmp/researchhub-security-tools/gitleaks uv run --project ai-worker --frozen python -m coverage run --branch --source=scripts/security --omit='*/test_*' --data-file=security-reports/.coverage -m unittest discover -s scripts/security -p 'test_*.py'
uv run --project ai-worker --frozen python -m coverage report --data-file=security-reports/.coverage --fail-under=80
python3 scripts/security/check.py hygiene
python3 scripts/security/check.py secrets --gitleaks /tmp/researchhub-security-tools/gitleaks
python3 scripts/security/check.py dependencies --trivy /tmp/researchhub-security-tools/trivy
```

Use a full clone (`git fetch --unshallow` when needed) for the history scan. Exit status is 0 for a
successful check, 1 for a policy finding and 2 when a complete check could not be established.
Local untracked files are outside the gate until added to the index. Do not confuse an ignored
local secrets file with a credential committed to Git.

For image coverage, run `ResearchHub security regression` manually with `scan_containers=true`. It builds only
the existing worker/sandbox Dockerfiles and scans both OS and installed language dependencies.
The job does not publish or deploy images. Base-image/OS findings are evaluated independently from
clean manifest scans; update the pinned base through a separate reviewed image change when needed.
The local image scan on 2026-10-07 found **97 HIGH/CRITICAL OS-package findings per image** (88 HIGH,
9 CRITICAL) in the existing Debian 12.11 bases. Both optional image gates therefore failed as
designed. No Python-package HIGH/CRITICAL findings remained after the lockfile updates. This task
does not claim the images are ready for public exposure: the base-layer findings require a reviewed
base-image update and assessment of unfixed/distribution-specific advisories before deployment.
The existing sandbox's isolated execution, network restrictions and server-side authorization
remain unchanged.

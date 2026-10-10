#!/usr/bin/env python3
"""Host backend + five local Compose services. No cloud account or public registration."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import signal
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

from api import save_private

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".demo/local"
JAR = ROOT / "backend/target/backend-0.0.1-SNAPSHOT.jar"
URL = "https://localhost:8443"
BACKEND = "http://127.0.0.1:28081"


def run(args, **kwargs):
    return subprocess.run(args, cwd=kwargs.pop("cwd", ROOT), check=True, **kwargs)


def compose():
    command = ["docker", "compose", "--env-file", str(STATE / "demo.env"), "-f", "infra/demo/compose.demo.yaml"]
    if platform.system() == "Linux":
        command += ["-f", "infra/demo/compose.demo.linux.yaml"]
    return command


def fingerprint(paths):
    digest = hashlib.sha256()
    for name in sorted(paths):
        path = ROOT / name
        files = sorted(path.rglob("*")) if path.is_dir() else [path]
        for file in files:
            if file.is_file():
                digest.update(str(file.relative_to(ROOT)).encode())
                digest.update(file.read_bytes())
    return digest.hexdigest()


def credentials():
    file = STATE / "demo.env"
    if not file.exists():
        file.write_text("".join(f"{key}={secrets.token_urlsafe(36)}\n" for key in
            ("DEMO_DB_PASSWORD", "AI_WORKER_SERVICE_TOKEN", "COLLABORATION_SERVICE_TOKEN", "METRICS_SCRAPE_TOKEN")))
        file.chmod(0o600)
    return dict(line.split("=", 1) for line in file.read_text().splitlines() if line)


def worker_setting(name):
    return name.startswith(("GEMINI_", "OPENAI_COMPAT_", "FOUNDRY_", "AZURE_EMBEDDING_")) or name in (
        "AI_WORKER_MODEL_PROVIDER", "AI_WORKER_EMBEDDING_PROVIDER")


def without_worker_settings(values):
    return {name: value for name, value in values.items() if not worker_setting(name)}


def worker_env(values=None, seeding=False):
    """Read only worker settings from private .env, without evaluating shell syntax.

    Process environment wins over .env, which wins over the generated private demo
    file. Neither the key nor provider settings are copied to Spring or the bundle.
    """
    config = dict(values or {})
    file = ROOT / ".env"
    if file.exists():
        for line in file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            name, separator, value = line.removeprefix('export ').partition('=')
            name = name.strip()
            if separator and worker_setting(name):
                value = value.strip()
                if value.startswith(('"', "'")):
                    if len(value) < 2 or value[-1] != value[0]:
                        raise RuntimeError('Malformed quoted worker setting in .env: ' + name)
                    value = value[1:-1]
                config[name] = value
    config.update(os.environ)
    if seeding:
        config = without_worker_settings(config)
        config.update(AI_WORKER_MODEL_PROVIDER='deterministic', AI_WORKER_EMBEDDING_PROVIDER='deterministic')
    return config


def selected_provider(settings, selector):
    return settings.get(selector) or ('gemini' if settings.get('GEMINI_API_KEY') else 'deterministic')


def reindex_demo(values, settings):
    """An explicit, resumable source reprocessing event; never relabel stored vectors."""
    from api import Client, wait_for
    stamp = STATE / 'embedding-profile.json'
    checkpoint = STATE / 'embedding-reprocessing.json'
    if selected_provider(settings, 'AI_WORKER_EMBEDDING_PROVIDER') == 'deterministic' and not stamp.exists():
        return
    request = urllib.request.Request('http://127.0.0.1:28090/internal/embeddings/model',
        headers={'Authorization': 'Bearer ' + values['AI_WORKER_SERVICE_TOKEN']})
    with urllib.request.urlopen(request, timeout=10) as response:
        profile = json.load(response)
    if stamp.exists() and json.loads(stamp.read_text()) == profile:
        return
    manifest = json.loads((STATE / 'seed-manifest.json').read_text())
    context = ssl.create_default_context(cafile=str(STATE / 'root.crt'))
    wait_health(URL + '/actuator/health/readiness', context)
    client = Client(URL, ssl_context=context)
    client.login(json.loads((STATE / 'accounts.json').read_text())['accounts']['owner'])
    route = '/api/workspaces/' + manifest['workspaceId'] + '/sources'
    progress = json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    if progress.get('profile') != profile:
        progress = {'profile': profile, 'completed': {}}
    print('Embedding model changed: reprocessing demo sources through the authorized API.', flush=True)
    for source in client.get(route):
        path = route + '/' + source['id']
        if progress['completed'].get(source['id']) == source['activeVersionId'] and source['status'] == 'READY':
            continue
        if source['status'] in ('PROCESSING', 'UPLOADED'):
            wait_for(lambda: client.get(path), lambda item: item['status'] in ('READY', 'FAILED'), timeout=300)
        client.post(path + '/reprocess')
        updated = wait_for(lambda: client.get(path), lambda item: item['status'] in ('READY', 'FAILED'), timeout=300)
        if updated['status'] != 'READY':
            raise RuntimeError('Embedding reprocessing failed for source ' + source['id'] + '; check the worker configuration and retry up.sh')
        progress['completed'][source['id']] = updated['activeVersionId']
        save_private(checkpoint, progress)
    save_private(stamp, profile)
    checkpoint.unlink(missing_ok=True)


def build():
    groups = {
        "backend": ["backend/src", "backend/pom.xml", "backend/.mvn", "backend/mvnw"],
        "frontend": ["frontend/src", "frontend/package-lock.json", "frontend/package.json", "frontend/webpack.config.cjs", "frontend/babel.config.cjs", "frontend/security"],
        "images": ["ai-worker/src", "ai-worker/Dockerfile", "ai-worker/uv.lock", "ai-worker/pyproject.toml", "collaboration/src", "collaboration/Dockerfile", "collaboration/tsconfig.json", "collaboration/package-lock.json", "collaboration/package.json", "infra/demo/Dockerfile.caddy"],
    }
    for group, paths in groups.items():
        value = fingerprint(paths)
        stamp = STATE / (group + ".sha256")
        present = {"backend": JAR.exists(), "frontend": (ROOT / "frontend/dist/index.html").exists(), "images": True}[group]
        if group == "images":
            present = all(subprocess.run(["docker", "image", "inspect", image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
                          for image in ("researchhub-ai-worker:demo", "researchhub-collaboration:demo", "researchhub-caddy:local-demo"))
        if present and stamp.exists() and stamp.read_text() == value:
            continue
        if group == "backend":
            run([str(ROOT / "backend/mvnw"), "-q", "-DskipTests", "package"], cwd=ROOT / "backend", env=without_worker_settings(os.environ))
        elif group == "frontend":
            run(["npm", "ci", "--prefix", "frontend", "--no-audit", "--no-fund"], env=without_worker_settings(os.environ), umask=0o022)
            env = {**without_worker_settings(os.environ), "RESEARCHHUB_API_BASE_URL": "", "RESEARCHHUB_COLLABORATION_ENABLED": "true", "RESEARCHHUB_CSP_CONNECT_ORIGINS": "wss://localhost:8443"}
            run(["npm", "run", "build", "--prefix", "frontend"], env=env, umask=0o022)
        else:
            run(compose() + ["build", "ai-worker", "collaboration", "caddy"], env=without_worker_settings(os.environ))
        stamp.write_text(value)
    # Caddy uses a different UID. Only the already-public bundle is world-readable;
    # credentials and process state retain the private parent umask.
    bundle = ROOT / "frontend/dist"
    bundle.chmod(0o755)
    for file in bundle.rglob("*"):
        file.chmod(0o755 if file.is_dir() else 0o644)
    sandbox = subprocess.run(["docker", "image", "inspect", "researchhub-sandbox:1.1.1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if sandbox.returncode != 0:
        run(["docker", "build", "-t", "researchhub-sandbox:1.1.1", "sandbox"])


def managed_pid():
    file = STATE / "backend.pid"
    if not file.exists():
        return None
    pid = int(file.read_text())
    probe = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True)
    # PID reuse never authorizes stopping an unrelated host process.
    return pid if probe.returncode == 0 and str(JAR) in probe.stdout and "--researchhub.demo.process=local" in probe.stdout else None


def stop_backend():
    pid = managed_pid()
    if pid is not None:
        os.kill(pid, signal.SIGTERM)
        for _ in range(60):
            if managed_pid() is None:
                break
            time.sleep(0.5)
        else:
            os.kill(pid, signal.SIGKILL)
    (STATE / "backend.pid").unlink(missing_ok=True)


def backend_env(values, seeding):
    docker_host = os.environ.get("DOCKER_HOST") or subprocess.run(
        ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], check=True, capture_output=True, text=True).stdout.strip()
    if not docker_host.startswith("unix://"):
        raise RuntimeError("The demo sandbox requires a local Unix Docker socket")
    return {**without_worker_settings(os.environ), **without_worker_settings(values), "SPRING_PROFILES_ACTIVE": "local,demo", "SERVER_ADDRESS": "127.0.0.1", "SERVER_PORT": "28081",
        "DB_HOST": "127.0.0.1", "DB_PORT": "25432", "DB_NAME": "researchhub", "DB_USER": "researchhub", "DB_PASSWORD": values["DEMO_DB_PASSWORD"],
        "AZURITE_BLOB_ENDPOINT": "http://127.0.0.1:21000/devstoreaccount1", "BLOB_CREATE_CONTAINER_ON_STARTUP": "true",
        "AI_WORKER_BASE_URL": "http://127.0.0.1:28090", "ANALYSIS_SANDBOX_ENABLED": "true", "ANALYSIS_SANDBOX_SOCKET_PATH": docker_host[7:],
        "COLLABORATION_WEBSOCKET_URL": URL.replace("https:", "wss:") + "/collaboration", "INSTANCE_ID": "local-demo",
        "REGISTRATION_MODE": "open" if seeding else "disabled", "COLLABORATION_ENABLED": "false" if seeding else "true", "COLLABORATION_INTERNAL_URL": "http://127.0.0.1:28091"}


def wait_health(url, context=None):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3, context=context) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(1)
    raise RuntimeError("Readiness timed out: " + url + "; inspect " + str(STATE / "backend.log"))


def start_backend(values, seeding=False):
    args = ["java", "-jar", str(JAR), "--researchhub.demo.process=local", "--researchhub.auth.registration.mode=" + ("open" if seeding else "disabled"),
            "--researchhub.collaboration.enabled=" + ("false" if seeding else "true")]
    if seeding:
        args += ["--server.servlet.session.cookie.secure=false", "--researchhub.environment=local"]
    with (STATE / "backend.log").open("ab") as log:
        process = subprocess.Popen(args, cwd=ROOT, env=backend_env(values, seeding), stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    (STATE / "backend.pid").write_text(str(process.pid))
    wait_health(BACKEND + "/actuator/health/readiness")


def smoke():
    from api import Client
    context = ssl.create_default_context(cafile=str(STATE / "root.crt"))
    wait_health(URL + "/actuator/health/readiness", context)
    client = Client(URL, ssl_context=context)
    facts = client.get("/api/public/config")
    if not facts["demo"] or facts["registrationMode"] != "disabled" or facts["ai"]["mode"] not in ('deterministic', 'live'):
        raise RuntimeError("Demo runtime facts do not match the safe baseline")
    manifest = json.loads((STATE / "seed-manifest.json").read_text())
    account = json.loads((STATE / "accounts.json").read_text())["accounts"]["demo-editor"]
    client.login(account)
    base = "/api/workspaces/" + manifest["workspaceId"]
    if facts['ai']['mode'] == 'live':
        metadata = client.get(base + '/ai/model')
        if metadata['provider'] == 'deterministic' or metadata['name'] != facts['ai']['modelName']:
            raise RuntimeError('Live model runtime facts differ from the worker')
    client.get(base + "/documents/" + manifest["documentId"])
    record = client.get(base + "/analyses/" + manifest["analysisId"] + "/executions/" + manifest["executionId"] + "/record")
    if record["execution"]["status"] != "SUCCEEDED" or not record["charts"]:
        raise RuntimeError("Seeded computation and chart are missing")
    client.post("/api/auth/register", {"email": "blocked@rc-demo.example.test", "password": "this-is-a-demo-only-password", "displayName": "Blocked"}, expected=(403,))
    print("Smoke passed: signed-in workspace, real execution, chart provenance and closed registration.")


def up():
    started = time.monotonic()
    for executable in ("docker", "java", "npm"):
        if shutil.which(executable) is None:
            raise RuntimeError("Missing prerequisite: " + executable)
    run(["docker", "info"], stdout=subprocess.DEVNULL)
    values = credentials()
    settings = worker_env(values)
    build()
    needs_seed = not (STATE / 'seed-manifest.json').exists()
    run(compose() + ["up", "-d", "--wait", "--wait-timeout", "180", "postgres", "azurite", "ai-worker"],
        env=worker_env(values, seeding=True) if needs_seed else settings)
    if needs_seed:
        # A partial seed is resumed using its saved credentials; existing content is never overwritten.
        run(compose() + ["stop", "caddy", "collaboration"])
        stop_backend()
        try:
            start_backend(values, seeding=True)
            run([sys.executable, "scripts/demo/seed.py", "--base-url", BACKEND, "--state", str(STATE / "accounts.json"), "--load-users", "0"])
        finally:
            stop_backend()
        run(compose() + ['up', '-d', '--wait', '--wait-timeout', '180', 'ai-worker'], env=settings)
    stamp = STATE / "running.sha256"
    desired = fingerprint(["backend/src/main", "backend/pom.xml", "scripts/demo/stack.py"])
    provider_identity = {key: value for key, value in settings.items() if worker_setting(key) and not key.endswith('_API_KEY')}
    provider_identity.update(modelProvider=selected_provider(settings, 'AI_WORKER_MODEL_PROVIDER'),
                             embeddingProvider=selected_provider(settings, 'AI_WORKER_EMBEDDING_PROVIDER'))
    desired += hashlib.sha256(json.dumps(provider_identity, sort_keys=True).encode()).hexdigest()
    if managed_pid() is None or not stamp.exists() or stamp.read_text() != desired:
        stop_backend(); start_backend(values); stamp.write_text(desired)
    run(compose() + ["up", "-d", "--wait", "--wait-timeout", "180", "collaboration", "caddy"])
    run(compose() + ["cp", "caddy:/data/caddy/pki/authorities/local/root.crt", str(STATE / "root.crt")])
    reindex_demo(values, settings)
    smoke()
    accounts = json.loads((STATE / "accounts.json").read_text())["accounts"]
    print(f"Demo: {URL} (ready in {time.monotonic() - started:.1f}s)")
    for slug in ("demo-editor", "collaboration-editor"):
        print(f"{accounts[slug]['email']}  password={accounts[slug]['password']}")
    print("Local HTTPS CA: .demo/local/root.crt. Browser trust instructions: docs/deployment/demo.md")


def down(reset=False):
    stop_backend()
    if not (STATE / "demo.env").exists():
        return
    run(compose() + ["down"] + (["-v"] if reset else []))
    if reset:
        for name in ("accounts.json", "seed-manifest.json", "k6.json", "running.sha256", "root.crt", 'embedding-profile.json', 'embedding-reprocessing.json'):
            (STATE / name).unlink(missing_ok=True)


def main(action):
    os.umask(0o077); STATE.mkdir(parents=True, exist_ok=True); STATE.chmod(0o700)
    with (STATE / "stack.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if action == "up": up()
        elif action == "down": down()
        elif action == "reset": down(reset=True); up()
        elif action == "smoke": smoke()
        else: raise ValueError("Use up, down, reset or smoke")


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

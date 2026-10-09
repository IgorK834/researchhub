#!/usr/bin/env python3
"""Verify unprivileged runtime contracts and exercise the static hosting image."""
import json
import subprocess
import urllib.request
import time

IMAGES = ("researchhub-backend:demo", "researchhub-frontend:demo", "researchhub-ai-worker:demo", "researchhub-sandbox:1.1.1")
images = json.loads(subprocess.check_output(["docker", "image", "inspect", *IMAGES], text=True))
for image in images:
    config = image["Config"]
    assert config["User"].split(":")[0] not in ("", "0", "root"), image["RepoTags"]
    assert not any(value.startswith(("DB_PASSWORD=", "BLOB_CONNECTION_STRING=", "AI_WORKER_SERVICE_TOKEN=", "FOUNDRY_API_KEY=", "OPENAI_COMPAT_API_KEY=", "GEMINI_API_KEY=")) for value in config["Env"])
    if "researchhub-sandbox:1.1.1" in image["RepoTags"]:
        assert config.get("Healthcheck", {}).get("Test", ["NONE"]) == ["NONE"]
    else:
        assert config["Healthcheck"]["Test"], image["RepoTags"]
container = subprocess.check_output(["docker", "run", "-d", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:rw,nosuid,noexec,size=16m", "-p", "127.0.0.1:18084:8080", "researchhub-frontend:demo"], text=True).strip()
try:
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:18084/healthz", timeout=2) as response:
                assert response.status == 200
            break
        except OSError:
            time.sleep(.5)
    else:
        raise RuntimeError("Static frontend did not become healthy")
    with urllib.request.urlopen("http://127.0.0.1:18084/app/workspaces/synthetic", timeout=2) as response:
        assert response.status == 200
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert b"<!doctype html>" in response.read().lower()
finally:
    subprocess.run(["docker", "rm", "-f", container], check=True, stdout=subprocess.DEVNULL)
print("All four images use non-root runtimes; static SPA routing, health and response security headers pass")

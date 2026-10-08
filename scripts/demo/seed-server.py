#!/usr/bin/env python3
"""Run the existing backend on the host for one real local sandbox seed. No container gets the Docker socket."""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def main():
    subprocess.run(["python3", str(ROOT / "scripts/security/check_analysis_boundary.py")], check=True)
    env = dict(os.environ)
    values = dict(line.split("=", 1) for line in (ROOT / ".demo/scale.env").read_text().splitlines() if line)
    socket = Path.home() / ".docker/run/docker.sock"
    env.update(values)
    env.update({"SPRING_PROFILES_ACTIVE": "demo", "SPRING_MAIN_BANNER_MODE": "off", "SERVER_ADDRESS": "127.0.0.1", "SERVER_PORT": "18083", "DB_HOST": "127.0.0.1", "DB_PORT": "15532",
                "DB_PASSWORD": values["DEMO_DB_PASSWORD"], "AUTH_SESSION_STORE": "jdbc", "COST_QUOTA_STORE": "postgres",
                "AZURITE_BLOB_ENDPOINT": "http://127.0.0.1:11000/devstoreaccount1", "AI_WORKER_BASE_URL": "http://127.0.0.1:18090",
                "ANALYSIS_SANDBOX_ENABLED": "true", "ANALYSIS_SANDBOX_SOCKET_PATH": str(socket if socket.exists() else Path("/var/run/docker.sock")),
                "REGISTRATION_MODE": "open", "COLLABORATION_ENABLED": "false",
                "RESEARCHHUB_ENVIRONMENT": "local", "SERVER_SERVLET_SESSION_COOKIE_SECURE": "false",
                "INSTANCE_ID": "seed-host", "SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE": "8"})
    os.execvpe("java", ["java", "-jar", str(ROOT / "backend/target/backend-0.0.1-SNAPSHOT.jar")], env)


if __name__ == "__main__":
    main()

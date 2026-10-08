#!/usr/bin/env python3
"""Prove session portability and an exact shared admission limit through public REST."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import copy
import json
from pathlib import Path
import subprocess
import time
import uuid
from api import Client

COMPOSE = ["docker", "compose", "--env-file", ".demo/scale.env", "-f", "infra/demo/compose.scale.yaml"]


def replica(headers):
    return next((value for key, value in headers.items() if key.lower() == "x-replica-id"), None)


def sessions(seed, base_url, failover=True):
    client = Client(base_url)
    identity = client.login(seed["users"][0])["id"]
    distribution = Counter()
    for _ in range(100):
        body, headers, _ = client.request("GET", "/api/me")
        assert body["id"] == identity, "Session must retain the same authenticated user"
        distribution[replica(headers)] += 1
    assert set(distribution) == {"backend-1", "backend-2"}, distribution
    survivors = Counter()
    if failover:
        subprocess.run(COMPOSE + ["stop", "backend-1"], check=True, stdout=subprocess.DEVNULL)
        try:
            for _ in range(20):
                body, headers, _ = client.request("GET", "/api/me")
                assert body["id"] == identity
                survivors[replica(headers)] += 1
            assert survivors == {"backend-2": 20}, survivors
        finally:
            subprocess.run(COMPOSE + ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "180", "backend-1"], check=True, stdout=subprocess.DEVNULL)
    return {"authenticatedRequests": 100, "authenticationFailures": 0, "replicaDistribution": dict(distribution),
            "afterStoppingBackend1": dict(survivors), "sameSessionAfterFailover": failover}


def quotas(seed, base_url, limit=60):
    clients = []
    for account in seed["users"][:4]:
        client = Client(base_url)
        client.login(account)
        clients.append(client)
    assert len(clients) == 4, "At least four synthetic users are required to isolate the workspace limit"
    workspace = clients[0].post("/api/workspaces", {"name": "Synthetic global quota proof " + str(uuid.uuid4()), "description": "Disposable synthetic quota probe"})
    route = "/api/workspaces/" + workspace["id"]
    for account in seed["users"][1:4]:
        clients[0].post(route + "/members", {"email": account["email"], "role": "VIEWER"})
    # The production adapter uses aligned one-minute windows; never straddle the boundary.
    remaining = 60 - time.time() % 60
    if remaining < 15:
        time.sleep(remaining + 0.2)
    window = int(time.time() // 60)

    def attempt(index):
        original = clients[index % 4]
        client = Client("http://127.0.0.1:" + ("18081" if index % 2 == 0 else "18082"))
        for cookie in original.jar:
            client.jar.set_cookie(copy.copy(cookie))
        body, headers, status = client.request("POST", route + "/ai/questions",
            {"question": "Unrecorded humidity?", "selectedSourceIds": []}, expected=(200, 429))
        if status == 200:
            assert body["status"] == "INSUFFICIENT_EVIDENCE"
        return status, replica(headers)

    with ThreadPoolExecutor(max_workers=16) as executor:
        results = list(executor.map(attempt, range(128)))
    assert int(time.time() // 60) == window, "Discard a quota run spanning two admission windows"
    counts = Counter(status for status, _ in results)
    admitted = Counter(instance for status, instance in results if status == 200)
    rejected = Counter(instance for status, instance in results if status == 429)
    assert counts[200] == limit and counts[429] == 128 - limit, counts
    assert set(admitted) == {"backend-1", "backend-2"}, admitted
    return {"workspaceLimit": limit, "userLimit": 20, "users": 4, "attempts": 128,
            "admitted": counts[200], "rejected": counts[429], "admittedByReplica": dict(admitted),
            "rejectedByReplica": dict(rejected), "window": window, "workspaceId": workspace["id"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=Path, default=Path(".demo/k6.json"))
    parser.add_argument("--base-url", default="http://127.0.0.1:18080")
    parser.add_argument("--output", type=Path, default=Path(".demo/consistency.json"))
    parser.add_argument("--skip-failover", action="store_true")
    args = parser.parse_args()
    seed = json.loads(args.seed.read_text())
    result = {"sessions": sessions(seed, args.base_url, not args.skip_failover), "quotas": quotas(seed, args.base_url)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

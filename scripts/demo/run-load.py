#!/usr/bin/env python3
"""Retain every configured local run, resource sample and exact script/compose identity."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import csv
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import statistics
import subprocess
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
K6 = "grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34"
COMPOSE = ["docker", "compose", "--env-file", ".demo/scale.env", "-f", "infra/demo/compose.scale.yaml"]
SERVICES = ("backend-1", "backend-2", "postgres", "ai-worker")


def percentile(values, probability):
    values = sorted(values)
    if not values:
        return None
    position = (len(values) - 1) * probability
    lower = int(position)
    fraction = position - lower
    return values[lower] + (values[min(lower + 1, len(values) - 1)] - values[lower]) * fraction


def aggregate(path):
    durations = defaultdict(list)
    errors = Counter()
    replicas = Counter()
    authentication_failures = 0
    with path.open() as source:
        for line in source:
            point = json.loads(line)
            if point.get("type") != "Point":
                continue
            metric, data = point["metric"], point["data"]
            tags = data.get("tags", {})
            endpoint = tags.get("endpoint", "untagged")
            if metric == "http_req_duration" and tags.get("phase") == "run":
                durations[endpoint].append(data["value"])
                if tags.get("status") not in ("200", "204"):
                    errors[endpoint] += 1
            elif metric == "replica_requests":
                replicas[tags["replica"]] += int(data["value"])
            elif metric == "authentication_failures":
                authentication_failures += int(data["value"])
    values = [value for samples in durations.values() for value in samples]
    return {"requests": len(values), "authenticationFailures": authentication_failures,
            "errorRate": sum(errors.values()) / len(values) if values else 1,
            "replicaDistribution": dict(replicas),
            "latencyMs": {name: percentile(values, q) for name, q in (("p50", .5), ("p95", .95), ("p99", .99))},
            "endpoints": {endpoint: {"requests": len(samples), "errors": errors[endpoint],
                **{name: percentile(samples, q) for name, q in (("p50", .5), ("p95", .95), ("p99", .99))}}
                for endpoint, samples in sorted(durations.items())}}


def memory_bytes(value):
    match = re.fullmatch(r"([0-9.]+)([KMGT]?i?B)", value.strip())
    if not match:
        raise ValueError("Unknown Docker memory unit")
    unit = match[2]
    exponent = {"B":0,"KB":1,"MB":2,"GB":3,"TB":4,"KiB":1,"MiB":2,"GiB":3,"TiB":4}[unit]
    return round(float(match[1]) * (1024 if "i" in unit else 1000) ** exponent)


def gauge(text, name):
    match = re.search(r"^" + re.escape(name) + r"(?:\{[^\n]*\})? ([0-9.eE+-]+)$", text, re.MULTILINE)
    return float(match[1]) if match else None


def collect(stop, rows, phase, token, failures):
    identities = subprocess.check_output(COMPOSE + ["ps", "-q", *SERVICES], text=True).split()
    while not stop.is_set():
        try:
            stats = subprocess.check_output(["docker","stats","--no-stream","--format","{{json .}}",*identities],text=True,timeout=20)
            connections = int(subprocess.check_output(COMPOSE + ["exec","-T","postgres","psql","-U","researchhub","-d","researchhub","-Atc",
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"],text=True,timeout=10).strip())
            for line in stats.splitlines():
                item = json.loads(line)
                service = next(name for name in SERVICES if item["Name"].endswith("-" + name + "-1"))
                pool = {}
                if service.startswith("backend"):
                    port = 18081 if service == "backend-1" else 18082
                    request = urllib.request.Request(f"http://127.0.0.1:{port}/actuator/prometheus", headers={"Authorization":"Bearer " + token})
                    with urllib.request.urlopen(request,timeout=5) as response:
                        text = response.read().decode()
                    pool = {name: gauge(text, "hikaricp_connections_" + name) for name in ("active","idle","pending","max")}
                rows.append({"timestamp":datetime.now(timezone.utc).isoformat(),"phase":phase,"service":service,
                    "cpu_percent":float(item["CPUPerc"].rstrip("%")),"memory_bytes":memory_bytes(item["MemUsage"].split("/")[0]),
                    "db_connections":connections,**{"pool_" + name:value for name,value in pool.items()}})
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            failures.append(type(error).__name__)
        stop.wait(5)


def script_hash():
    digest = hashlib.sha256()
    for path in sorted((ROOT / "performance/k6").rglob("*")):
        if path.is_file():
            digest.update(str(path.relative_to(ROOT)).encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()


def run(output, repetitions=2, scenarios=("smoke","api-read"), duration="2m"):
    output.mkdir(parents=True, exist_ok=True)
    if (output / "k6-summary.json").exists():
        raise ValueError("Existing evidence must be preserved; choose a fresh --output directory")
    raw_directory = ROOT / ".demo/load" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    raw_directory.mkdir(parents=True, exist_ok=True)
    config = dict(line.split("=",1) for line in (ROOT / ".demo/scale.env").read_text().splitlines() if line)
    rows, sampling_failures, results = [], [], []
    scripts_sha = script_hash()
    for repetition in range(1, repetitions + 1):
        for scenario in scenarios:
            name = f"{scenario}-{repetition}"
            raw = raw_directory / (name + ".json")
            summary = output / (name + "-summary.json")
            stop = threading.Event()
            collector = threading.Thread(target=collect,args=(stop,rows,name,config["METRICS_SCRAPE_TOKEN"],sampling_failures))
            collector.start()
            command = ["docker","run","--rm","--user",f"{os.getuid()}:{os.getgid()}",
                "--network","researchhub-scale_default","-v",f"{ROOT}:/work","-w","/work",
                "-e","BASE_URL=http://caddy:8080","-e","SEED_FILE=/work/.demo/k6.json","-e",f"DURATION={duration}",
                K6,"run","--out",f"json=/work/{raw.relative_to(ROOT)}","--summary-export",f"/work/{summary.relative_to(ROOT)}",
                f"/work/performance/k6/{scenario}.js"]
            try:
                with (raw_directory / (name + ".log")).open("w") as log:
                    status = subprocess.run(command,stdout=log,stderr=subprocess.STDOUT).returncode
            finally:
                stop.set()
                collector.join(timeout=30)
            result = {"scenario":scenario,"run":repetition,"exitCode":status,"scriptSha256":scripts_sha,
                      "summary":summary.name, **aggregate(raw)}
            results.append(result)
            (output/"k6-summary.json").write_text(json.dumps({"runs":results},indent=2)+"\n")
            print(f"{name}: exit={status}, requests={result['requests']}, auth failures={result['authenticationFailures']}, error rate={result['errorRate']:.6f}, replicas={result['replicaDistribution']}",flush=True)
    fields = ["timestamp","phase","service","cpu_percent","memory_bytes","db_connections","pool_active","pool_idle","pool_pending","pool_max"]
    with (output/"metrics.csv").open("w") as destination:
        writer = csv.DictWriter(destination,fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    compose = ROOT/"infra/demo/compose.scale.yaml"
    (output/"compose.sha256").write_text(hashlib.sha256(compose.read_bytes()).hexdigest()+"  infra/demo/compose.scale.yaml\n")
    (output/"scripts.sha256").write_text(scripts_sha+"  performance/k6 (paths and bytes, recursively sorted)\n")
    (output/"commit.txt").write_text(subprocess.check_output(["git","rev-parse","HEAD"],text=True))
    machine = {"os":platform.platform(),"architecture":platform.machine(),
        "docker":json.loads(subprocess.check_output(["docker","info","--format","{{json .}}"],text=True)),
        "samplingFailures":sampling_failures}
    # Keep only resource/version facts; Docker info can otherwise contain unrelated local configuration.
    machine["docker"] = {key:machine["docker"].get(key) for key in ("ServerVersion","NCPU","MemTotal","OperatingSystem","Architecture")}
    if platform.system() == "Darwin":
        machine["host"] = {key:subprocess.check_output(["sysctl","-n",key],text=True).strip() for key in ("hw.model","hw.memsize","hw.ncpu","machdep.cpu.brand_string")}
    (output/"machine.json").write_text(json.dumps(machine,indent=2)+"\n")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=Path("performance/results/"+datetime.now().strftime("%Y-%m-%d")+"-local-two-instance"))
    parser.add_argument("--runs",type=int,choices=range(1,6),default=2)
    parser.add_argument("--scenarios",nargs="+",choices=("smoke","api-read","workspace","retrieval"),default=["smoke","api-read"])
    parser.add_argument("--duration",default="2m")
    args = parser.parse_args()
    results = run(args.output.resolve(),args.runs,tuple(args.scenarios),args.duration)
    if any(result["exitCode"] or result["authenticationFailures"] or result["errorRate"] >= .01 for result in results):
        raise SystemExit("At least one recorded run failed; all evidence has been retained")


if __name__ == "__main__":
    main()

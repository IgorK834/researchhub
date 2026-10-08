#!/usr/bin/env python3
"""RH-342: shared path selection, static validators and required-check gates."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess


FILTERS = {
    "backend": ("backend/", "ai-worker/", "collaboration/", "sandbox/", "contracts/", "compose.yaml", ".env.example"),
    "frontend": ("frontend/", "contracts/", ".dockerignore"),
    "ai-worker": ("ai-worker/", "contracts/"),
    "collaboration": ("collaboration/", "contracts/"),
    "sandbox": ("sandbox/", "ai-worker/pyproject.toml", "ai-worker/uv.lock"),
    "infra": ("infra/azure/",),
    "performance": ("performance/k6/", "performance/test/", "infra/demo/", "scripts/demo/"),
    "scripts": ("scripts/", "ai-worker/scripts/"),
    "regression": ("backend/", "frontend/", "ai-worker/", "collaboration/", "sandbox/", "contracts/", "compose.yaml", ".env.example"),
    "dependencies": ("scripts/security/", ".gitleaks.toml"),
}


def matches(path, patterns):
    return any(path.startswith(pattern) if pattern.endswith("/") else path == pattern for pattern in patterns)


def select_jobs(paths, root, full=False):
    selected = dict.fromkeys((*FILTERS, "docs"), full)
    for path in paths:
        if path.endswith(".md"):
            selected["docs"] = True
            continue
        if path.startswith("docs/"):
            selected["docs"] = True
        if matches(path, (".github/", "scripts/ci/")):
            selected = dict.fromkeys(selected, True)
            break
        for job, patterns in FILTERS.items():
            selected[job] |= matches(path, patterns)
        # Discover new dependency inventories rather than enumerating current projects only.
        if Path(path).name in {"pom.xml", "package.json", "package-lock.json", "pyproject.toml", "uv.lock", "requirements.lock", "requirements.txt"}:
            selected["dependencies"] = True
    selected["infra"] &= (root / "infra/azure").is_dir()
    selected["performance"] &= any((root / "performance/k6").glob("*.js"))
    return selected


def changed_paths(event):
    pull_request = event["pull_request"]
    base, head = pull_request["base"]["sha"], pull_request["head"]["sha"]
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (base, head)):
        raise ValueError("Expected full commit SHAs for the pull request diff")
    result = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "-z", f"{base}...{head}"],
        check=True, stdout=subprocess.PIPE,
    )
    return result.stdout.decode().split("\0")[:-1]


def changes(root):
    event_name = os.environ["GITHUB_EVENT_NAME"]
    if event_name not in {"pull_request", "push", "schedule", "workflow_dispatch"}:
        raise ValueError(f"Unsupported event: {event_name}")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    paths = changed_paths(event) if event_name == "pull_request" else []
    selected = select_jobs(paths, root, full=event_name != "pull_request")
    output = "".join(f"{job}={str(enabled).lower()}\n" for job, enabled in selected.items())
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as destination:
        destination.write(output)
    print(output, end="")


def validate(root, kind):
    if kind == "infra":
        for source in sorted((root / "infra/azure").rglob("*.bicep")):
            subprocess.run(["az", "bicep", "build", "--file", str(source), "--stdout"], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["az", "bicep", "lint", "--file", str(source)], check=True)
        for source in sorted((root / "infra/azure").rglob("*.bicepparam")):
            subprocess.run(["az", "bicep", "build-params", "--file", str(source), "--stdout"], check=True, stdout=subprocess.DEVNULL)
    elif kind == "performance":
        for source in sorted((root / "performance/k6").glob("*.js")):
            subprocess.run(["k6", "inspect", str(source)], check=True)
    else:
        result = subprocess.run(["git", "ls-files", "-z", "--", "scripts/", "ai-worker/scripts/"], check=True, stdout=subprocess.PIPE)
        for name in result.stdout.decode().split("\0")[:-1]:
            source = root / name
            if source.suffix == ".sh" or re.match(rb"#![^\n]*\b(?:sh|bash|dash|ksh)\b", source.read_bytes()[:128]):
                subprocess.run(["shellcheck", str(source)], check=True)


def gate(needs):
    # A skipped optional job is expected; the path-selection job must actually succeed.
    failed = [job for job, value in needs.items() if value["result"] not in {"success", "skipped"}]
    if needs.get("changes", {}).get("result") != "success":
        failed.append("changes")
    if failed:
        raise ValueError(f"Required jobs failed or were cancelled: {', '.join(sorted(set(failed)))}")
    print("All applicable jobs passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("check", choices=["changes", "infra", "performance", "scripts", "gate"])
    args = parser.parse_args()
    root = Path.cwd()
    if args.check == "changes":
        changes(root)
    elif args.check == "gate":
        gate(json.loads(os.environ["NEEDS_JSON"]))
    else:
        validate(root, args.check)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Validate/replay trusted erasure-ledger JSON downloaded from the Blob authority.

Run on a restored, offline database through psql's PGSERVICE/PG* configuration.
Dry run is the default. This never reads arbitrary uploads as restore authority.
"""
import argparse
import datetime
import json
from pathlib import Path
import subprocess
import uuid


def statement(entry):
    if set(entry) != {"schemaVersion", "requestId", "actorId", "workspaceIds", "policyVersion", "requestedAt"}:
        raise ValueError("Unexpected ledger fields")
    if entry["schemaVersion"] != "1.0" or entry["policyVersion"] != "ADR-014/live-erasure-v1":
        raise ValueError("Unsupported erasure policy")
    request_id, actor = uuid.UUID(entry["requestId"]), uuid.UUID(entry["actorId"])
    scopes = [str(uuid.UUID(value)) for value in entry["workspaceIds"]]
    accepted = datetime.datetime.fromisoformat(entry["requestedAt"])
    if accepted.tzinfo is None:
        raise ValueError("Ledger timestamp must include a timezone")
    array = "ARRAY[" + ",".join("'" + value + "'::uuid" for value in scopes) + "]::uuid[]"
    return f"SELECT replay_account_erasure('{request_id}'::uuid,'{actor}'::uuid,{array},'{accepted.isoformat()}'::timestamptz);"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ledger_directory", type=Path)
    parser.add_argument("--apply", action="store_true", help="Replay into the offline restored database")
    args = parser.parse_args()
    entries = [statement(json.loads(path.read_text())) for path in sorted(args.ledger_directory.glob("*.json"))]
    if not entries:
        raise SystemExit("No ledger receipts found; do not enable restored traffic without checking the authority")
    if args.apply:
        subprocess.run(["psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1"], input="BEGIN;\n" + "\n".join(entries) + "\nCOMMIT;\n", text=True, check=True)
    print(f"{'Replayed' if args.apply else 'Validated'} {len(entries)} erasure receipts. Keep traffic offline until live stores are reconciled.")


if __name__ == "__main__":
    main()

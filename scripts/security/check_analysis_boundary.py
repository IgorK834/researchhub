#!/usr/bin/env python3
"""RH-142 prerequisite: only committed, reviewed policy bytes permit execution checks.

Repository tooling only; never imports or executes generated analysis source.
Hashes bind bytes, not reviewer identity. Maintainer review remains necessary.
"""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ADR = 'docs/adr/ADR-008-analysis-execution-boundary.md'
THREAT_MODEL = 'docs/security/analysis-execution-threat-model.md'
REVIEW = 'docs/security/analysis-execution-review.json'
CAPABILITIES = ('contracts/analysis/execution/v3/README.md',
                'contracts/analysis/execution/v3/manifest.schema.json',
                'contracts/analysis/execution/v3/receipt.schema.json',
                'sandbox/requirements.lock', 'sandbox/Dockerfile')
DOCUMENTS = (ADR, THREAT_MODEL, *CAPABILITIES)
POLICY_PATHS = (*DOCUMENTS, REVIEW)


class BoundaryError(ValueError):
    """No generated-code execution is allowed after a failed prerequisite."""


def git(root, *arguments):
    try:
        result = subprocess.run(['git', '-C', str(root), *arguments], capture_output=True,
                                check=False, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise BoundaryError('Cannot verify the committed analysis security policy') from error
    if result.returncode != 0:
        raise BoundaryError('Analysis security policy/review must exist in committed HEAD')
    return result.stdout


def check_boundary(root):
    committed = {}
    for relative in POLICY_PATHS:
        path = root / relative
        if path.is_symlink() or not path.is_file():
            raise BoundaryError(f'Missing regular policy file: {relative}')
        committed[relative] = git(root, 'show', f'HEAD:{relative}')
        if path.read_bytes() != committed[relative]:
            raise BoundaryError(f'Review and commit policy changes before execution: {relative}')
    try:
        review = json.loads(committed[REVIEW])
        if not isinstance(review, dict):
            raise ValueError('Review must be an object')
        date.fromisoformat(review['reviewedAt'])
        accepted = (review['schemaVersion'] == '2.0' and review['decision'] == 'ACCEPTED_LOCAL'
                    and isinstance(review['reviewer'], str) and bool(review['reviewer'].strip())
                    and review['reviewKind'] in {'TECHNICAL_SELF_REVIEW', 'TECHNICAL_PEER_REVIEW', 'HUMAN_REVIEW'}
                    and review['cloudDecision'] == 'DEFERRED_PENDING_DEPLOYMENT_PARITY_REVIEW')
        if review['runtime'] != {'version': '1.2.0', 'sympy': '1.14.0', 'mpmath': '1.3.0'}:
            raise ValueError('Unreviewed scientific runtime')
        if b'sympy==1.14.0\n' not in committed['sandbox/requirements.lock'] or b'mpmath==1.3.0\n' not in committed['sandbox/requirements.lock'] or b'org.opencontainers.image.version="1.2.0"' not in committed['sandbox/Dockerfile']:
            raise ValueError('Runtime capabilities differ from the review')
        baseline = review['auditedBaseline']
        if not accepted or not isinstance(baseline, str) or not re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', baseline):
            raise ValueError('Review is not accepted')
        expected = {path: hashlib.sha256(committed[path]).hexdigest() for path in DOCUMENTS}
        if review['documents'] != expected:
            raise ValueError('Document hashes do not match the review')
        if b'- Status: Accepted for the local execution contract; cloud execution deferred\n' not in committed[ADR]:
            raise ValueError('ADR is not accepted')
    except (KeyError, TypeError, ValueError) as error:
        raise BoundaryError('Missing, rejected or stale analysis security review; review and commit it first') from error
    git(root, 'merge-base', '--is-ancestor', baseline, 'HEAD')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    try:
        check_boundary(args.root)
    except (BoundaryError, OSError) as error:
        print(f'RH-142 BLOCKED: {error}', file=sys.stderr)
        return 1
    print('RH-142: reviewed local analysis boundary is committed; cloud execution remains deferred')
    return 0


if __name__ == '__main__':
    sys.exit(main())

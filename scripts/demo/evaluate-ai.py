#!/usr/bin/env python3
"""Measure the fixed model matrix with worker-only credentials from private .env.

Use the pinned local worker environment when available, otherwise the existing demo
worker container. Exit 1 means the preferred model did not meet the fixed thresholds
or was unavailable; the report is still produced. No credentials enter the report.
"""
import secrets
import subprocess
import sys

from stack import ROOT, STATE, compose, worker_env


def evaluate():
    output = STATE / 'evaluation'
    output.mkdir(parents=True, exist_ok=True)
    matrix = ROOT / 'docs/evaluation/models/demo-matrix.json'
    python = ROOT / 'ai-worker/.venv/bin/python'
    if python.is_file():
        result = subprocess.run([str(python), '-m', 'researchhub_worker.evaluation', 'models',
            '--matrix', str(matrix), '--output', str(output)], cwd=ROOT / 'ai-worker', env=worker_env())
        return result.returncode
    temporary = '/tmp/researchhub-evaluation-' + secrets.token_hex(8)
    # The container's existing environment already owns the key. Only the public
    # matrix crosses stdin; no key appears in a command argument or Docker copy.
    code = '''import json, pathlib, sys
from researchhub_worker.evaluation.__main__ import main
root = pathlib.Path(sys.argv[1]); root.mkdir()
matrix = root / 'matrix.json'; matrix.write_text(sys.stdin.read())
sys.exit(main(['models','--matrix',str(matrix),'--output',str(root / 'report')]))
'''
    result = subprocess.run(compose() + ['exec', '-T', 'ai-worker', 'python', '-c', code, temporary],
        cwd=ROOT, input=matrix.read_text(), text=True)
    try:
        subprocess.run(compose() + ['cp', 'ai-worker:' + temporary + '/report/.', str(output)], cwd=ROOT, check=True)
    finally:
        subprocess.run(compose() + ['exec', '-T', 'ai-worker', 'python', '-c',
            'import shutil,sys;shutil.rmtree(sys.argv[1],ignore_errors=True)', temporary], cwd=ROOT, check=True)
    return result.returncode


if __name__ == '__main__':
    try:
        status = evaluate()
        print('Evaluation report: ' + str(STATE / 'evaluation/models.md'))
        sys.exit(status)
    except (OSError, RuntimeError, subprocess.SubprocessError):
        print('Evaluation could not complete. Start scripts/demo/up.sh or prepare the pinned ai-worker environment.', file=sys.stderr)
        sys.exit(2)

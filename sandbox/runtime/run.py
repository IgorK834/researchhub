"""Trusted launcher: fixed paths and environment, never a web service or a Python in-process evaluator."""
from pathlib import Path
import subprocess
import sys

# -I prevents user-site/PYTHONPATH imports. This is a fixed, root-owned read-only image directory.
sys.path.insert(0, '/opt/researchhub')
from protocol import ProtocolError, MAX_CODE_BYTES, regular_file, validate_manifest, validate_result

CHILD_ENV = {
    'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp', 'TMPDIR': '/tmp',
    'MPLCONFIGDIR': '/tmp/matplotlib', 'MPLBACKEND': 'Agg',
    'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1',
    'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1',
}


def execute(execution_root=Path('/execution'), inputs_root=Path('/inputs'), outputs_root=Path('/outputs')):
    manifest = validate_manifest(execution_root / 'manifest.json', inputs_root)
    code = regular_file(execution_root / 'code.py', MAX_CODE_BYTES)
    if not code.strip() or any(outputs_root.iterdir()):
        raise ProtocolError('SANDBOX_OUTPUT_INVALID')
    completed = subprocess.run([sys.executable, '-I', str(execution_root / 'code.py')],
                               cwd=execution_root, env=CHILD_ENV.copy(), check=False)
    if completed.returncode != 0:
        return completed.returncode if completed.returncode > 0 else 128 - completed.returncode
    validate_result(manifest, outputs_root)
    return None


def main():
    try:
        if len(sys.argv) != 1:
            raise ProtocolError('SANDBOX_OUTPUT_INVALID')
        failure = execute()
    except (ProtocolError, OSError, ValueError, RecursionError):
        failure = 'SANDBOX_OUTPUT_INVALID'
    if failure:
        print('SANDBOX_OUTPUT_INVALID' if failure == 'SANDBOX_OUTPUT_INVALID' else 'SANDBOX_CODE_FAILED',
              file=sys.stderr, flush=True)
        return 65 if failure == 'SANDBOX_OUTPUT_INVALID' else failure
    return 0


if __name__ == '__main__':
    sys.exit(main())

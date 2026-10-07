#!/usr/bin/env python3
"""Repository-only security checks. No application credentials or runtime imports."""
import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path, PurePosixPath


class CheckError(Exception):
    """A check could not establish a complete, valid result."""


def tracked_files(root):
    result = subprocess.run(['git', 'ls-files', '-z'], cwd=root, check=True, capture_output=True)
    return [name for name in result.stdout.decode().split('\0') if name]


def forbidden_files(files):
    findings = []
    for name in files:
        path = PurePosixPath(name.lower())
        base = path.name
        environment = (base == '.env' or base.startswith('.env.')) and base != '.env.example'
        credential = (
            base in {'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.netrc', '.boto',
                     'credentials.json', 'kubeconfig'}
            or path.suffix in {'.key', '.pem', '.p12', '.pfx', '.jks', '.keystore'}
            or '.aws/credentials' in str(path)
            or base.startswith('service-account') and base.endswith('.json')
            or base.endswith('-credentials.json')
            or '.tfstate' in base
        )
        if environment or credential:
            findings.append(name)
    return findings


def dependency_inputs(files):
    """Discover every supported project, requiring an inventory for npm/Python."""
    names = set(files)
    inputs = {}
    for name in sorted(names):
        path = PurePosixPath(name)
        if path.name == 'pom.xml':
            inputs[name] = name
        elif path.name == 'package.json':
            lock = str(path.with_name('package-lock.json'))
            if lock not in names:
                raise CheckError(f'Missing npm lockfile: {lock}')
            inputs[name] = name
            inputs[lock] = lock
        elif path.name == 'pyproject.toml':
            candidates = [str(path.with_name(lock)) for lock in ('uv.lock', 'requirements.lock', 'requirements.txt')]
            if not any(lock in names for lock in candidates):
                raise CheckError(f'Missing Python dependency inventory beside {name}')
        elif path.name in {'uv.lock', 'requirements.txt', 'requirements.lock'}:
            inputs[name] = str(path.with_name('requirements.txt')) if path.name == 'requirements.lock' else name
    if not inputs:
        raise CheckError('No dependency inventories found')
    return inputs


def copy_files(root, inputs, destination):
    for source, target in inputs.items():
        original = root / source
        if original.is_symlink() or not original.resolve().is_relative_to(root.resolve()):
            raise CheckError(f'Scan input must be a repository file: {source}')
        output = destination / target
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, output)


def evaluate_report(report, expected):
    """Fail closed on partial scans, unresolved versions and invalid scanner output."""
    if report.get('SchemaVersion') != 2 or not isinstance(report.get('Results'), list):
        raise CheckError('Unsupported or incomplete Trivy JSON report')
    scanned = set()
    findings = []
    for result in report['Results']:
        target = result['Target']
        packages = result.get('Packages', [])
        if packages:
            scanned.add(target)
            if any(not package.get('Version') for package in packages):
                raise CheckError(f'Unresolved dependency version: {target}')
        for finding in result.get('Vulnerabilities', []):
            severity = finding.get('Severity', 'UNKNOWN')
            if severity not in {'UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'}:
                raise CheckError(f'Invalid severity in {target}')
            findings.append({
                'target': target, 'id': finding['VulnerabilityID'],
                'package': finding['PkgName'], 'version': finding['InstalledVersion'],
                'fixedVersion': finding.get('FixedVersion', ''), 'severity': severity,
            })
    missing = set(expected) - scanned
    if missing:
        raise CheckError(f'Incomplete dependency scan: {", ".join(sorted(missing))}')
    return findings


def run_scanner(command, log, cwd):
    with log.open('w') as output:
        result = subprocess.run(command, cwd=cwd, stdout=output, stderr=subprocess.STDOUT)
    if result.returncode:
        raise CheckError(f'Scanner failed (exit {result.returncode}); see {log}')


def dependencies(root, files, trivy, output):
    inputs = dependency_inputs(files)
    expected = [target for target in inputs.values() if PurePosixPath(target).name != 'package.json']
    reports = {}
    with tempfile.TemporaryDirectory(prefix='researchhub-dependencies-') as temporary:
        stage = Path(temporary)
        copy_files(root, inputs, stage)
        for label, extra in [('runtime', []), ('all', ['--include-dev-deps'])]:
            report_path = output / f'dependencies-{label}.json'
            run_scanner([
                trivy, 'fs', '--scanners', 'vuln', '--list-all-pkgs', '--format', 'json',
                '--output', str(report_path), '--exit-code', '0', '--timeout', '10m',
                *extra, str(stage),
            ], output / f'dependencies-{label}.log', stage)
            reports[label] = evaluate_report(json.loads(report_path.read_text()), expected)
    failures = [finding for finding in reports['runtime'] if finding['severity'] in {'HIGH', 'CRITICAL'}]
    summary = {'scannedInventories': sorted(expected), 'blocking': failures,
               'runtimeFindings': reports['runtime'], 'allFindingsIncludingDev': reports['all']}
    (output / 'dependency-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    for finding in reports['all']:
        blocks = finding in failures
        level = 'error' if blocks else 'warning'
        print(f'::{level}::{finding["severity"]} {finding["id"]} {finding["package"]} '
              f'{finding["version"]} ({finding["target"]}); fixed: {finding["fixedVersion"] or "not available"}')
    print(f'Dependency inventories: {len(expected)}; blocking findings: {len(failures)}')
    return 1 if failures else 0


def secrets(root, files, gitleaks, output):
    if subprocess.run(['git', 'rev-parse', '--is-shallow-repository'], cwd=root,
                      check=True, capture_output=True, text=True).stdout.strip() != 'false':
        raise CheckError('Secret history scan requires checkout fetch-depth: 0')
    config = root / '.gitleaks.toml'
    common = [gitleaks, '--config', str(config), '--redact=100', '--no-banner', '--report-format', 'json']
    # Both reports are generated even when history already contains a finding.
    found = False
    with tempfile.TemporaryDirectory(prefix='researchhub-secrets-') as temporary:
        stage = Path(temporary)
        copy_files(root, {name: name for name in files}, stage)
        for label, arguments in [('history', ['git', '--log-opts=--all', str(root)]),
                                 ('tracked', ['dir', str(stage)])]:
            log = output / f'secrets-{label}.log'
            with log.open('w') as stream:
                result = subprocess.run([*common, '--report-path', str(output / f'secrets-{label}.json'),
                                         *arguments], cwd=root, stdout=stream, stderr=subprocess.STDOUT)
            if result.returncode not in (0, 1):
                raise CheckError(f'Secret scanner failed (exit {result.returncode}); see {log}')
            found = found or result.returncode == 1
    print('Secret scan: findings detected; inspect redacted reports' if found else 'Secret scan: no findings')
    return 1 if found else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('check', choices=['hygiene', 'dependencies', 'secrets'])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output', type=Path, default=Path('security-reports'))
    parser.add_argument('--trivy', default='trivy')
    parser.add_argument('--gitleaks', default='gitleaks')
    args = parser.parse_args(argv)
    try:
        root, output = args.root.resolve(), args.output.resolve()
        files = tracked_files(root)
        if args.check == 'hygiene':
            findings = forbidden_files(files)
            for name in findings:
                print(f'::error file={name}::Forbidden environment/credential file is tracked')
            print(f'Tracked file hygiene: {len(findings)} findings')
            return 1 if findings else 0
        output.mkdir(parents=True, exist_ok=True)
        if args.check == 'dependencies':
            return dependencies(root, files, args.trivy, output)
        return secrets(root, files, args.gitleaks, output)
    except (CheckError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f'::error::Security check incomplete: {error}')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

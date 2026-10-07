import contextlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('repository_security', Path(__file__).with_name('check.py'))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def report(target='backend/pom.xml', severity=None):
    result = {'Target': target, 'Packages': [{'Name': 'example', 'Version': '1.0'}]}
    if severity:
        result['Vulnerabilities'] = [{'VulnerabilityID': 'CVE-test', 'PkgName': 'example',
                                      'InstalledVersion': '1.0', 'Severity': severity}]
    return {'SchemaVersion': 2, 'Results': [result]}


class SecurityChecksTest(unittest.TestCase):
    def test_sensitive_filenames_block_even_when_already_tracked(self):
        sensitive = ['.env', 'frontend/.env.production', 'x/.ENV.LOCAL', 'id_rsa',
                     'cert.pem', 'signing.key', 'bundle.p12', 'x.pfx', 'x.jks', 'x.keystore',
                     '.aws/credentials', '.netrc', '.boto', 'credentials.json', 'kubeconfig',
                     'service-account-prod.json', 'cloud-credentials.json', 'infra.tfstate.backup']
        self.assertEqual(check.forbidden_files(sensitive), sensitive)
        self.assertEqual(check.forbidden_files(['.env.example', 'frontend/.env.example',
                                               'id_rsa.pub', 'credentialsPolicy.ts', 'public.crt']), [])

    def test_all_projects_are_discovered_with_sandbox_lock_normalization(self):
        files = ['backend/pom.xml', 'frontend/package.json', 'frontend/package-lock.json',
                 'collaboration/package.json', 'collaboration/package-lock.json',
                 'ai-worker/pyproject.toml', 'ai-worker/uv.lock',
                 'sandbox/pyproject.toml', 'sandbox/requirements.lock', 'other/requirements.txt']
        inputs = check.dependency_inputs(files)
        self.assertEqual(inputs['sandbox/requirements.lock'], 'sandbox/requirements.txt')
        self.assertIn('collaboration/package-lock.json', inputs)
        self.assertIn('ai-worker/uv.lock', inputs)
        for bad in [[], ['new/package.json'], ['new/pyproject.toml']]:
            with self.subTest(bad=bad), self.assertRaises(check.CheckError):
                check.dependency_inputs(bad)

    def test_missing_inventory_or_unresolved_version_cannot_pass(self):
        for data in [{}, {'SchemaVersion': 1, 'Results': []}, report('wrong/pom.xml'),
                     {'SchemaVersion': 2, 'Results': [{'Target': 'backend/pom.xml', 'Packages': []}]}]:
            with self.subTest(data=data), self.assertRaises(check.CheckError):
                check.evaluate_report(data, ['backend/pom.xml'])
        data = report()
        data['Results'][0]['Packages'][0]['Version'] = ''
        with self.assertRaises(check.CheckError):
            check.evaluate_report(data, ['backend/pom.xml'])

    def test_severity_policy_retains_unfixed_findings(self):
        for severity in ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']:
            findings = check.evaluate_report(report(severity=severity), ['backend/pom.xml'])
            self.assertEqual(findings[0]['severity'], severity)
            self.assertEqual(findings[0]['fixedVersion'], '')
        with self.assertRaises(check.CheckError):
            check.evaluate_report(report(severity='invented'), ['backend/pom.xml'])

    def test_copy_rejects_symlinks_and_preserves_inventory_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'pom.xml').write_text('inventory')
            stage = root / 'stage'
            check.copy_files(root, {'pom.xml': 'backend/pom.xml'}, stage)
            self.assertEqual((stage / 'backend/pom.xml').read_text(), 'inventory')
            (root / 'link').symlink_to(root / 'pom.xml')
            for source in ['link', '../outside']:
                with self.subTest(source=source), self.assertRaises(check.CheckError):
                    check.copy_files(root, {source: 'target'}, stage)

    def test_dependency_gate_blocks_only_runtime_high_and_critical(self):
        for runtime, dev, expected in [('HIGH', 'HIGH', 1), ('CRITICAL', None, 1),
                                       ('MEDIUM', 'CRITICAL', 0), (None, 'HIGH', 0),
                                       ('UNKNOWN', 'UNKNOWN', 0)]:
            with self.subTest(runtime=runtime, dev=dev), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / 'pom.xml').write_text('fixture')
                def scanner(command, log, cwd):
                    destination = Path(command[command.index('--output') + 1])
                    destination.write_text(json.dumps(report('pom.xml', dev if '--include-dev-deps' in command else runtime)))
                with patch.object(check, 'run_scanner', side_effect=scanner), contextlib.redirect_stdout(io.StringIO()):
                    result = check.dependencies(root, ['pom.xml'], 'trivy', root)
                self.assertEqual(result, expected)
                summary = json.loads((root / 'dependency-summary.json').read_text())
                self.assertEqual(bool(summary['blocking']), bool(expected))

    def test_scanner_crash_is_not_a_warning(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(check.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2)):
            with self.assertRaises(check.CheckError):
                check.run_scanner(['trivy'], Path(temporary) / 'scan.log', Path(temporary))

    def test_secret_reports_redacted_and_both_scans_run_after_a_finding(self):
        for history, tracked, expected in [(0, 0, 0), (1, 0, 1), (0, 1, 1)]:
            with self.subTest(history=history, tracked=tracked), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                commands = []
                def runner(command, **kwargs):
                    commands.append(command)
                    code = history if 'git' in command and '--log-opts=--all' in command else tracked
                    return subprocess.CompletedProcess(command, code, stdout='false\n')
                with patch.object(check.subprocess, 'run', side_effect=runner), contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(check.secrets(root, [], 'gitleaks', root), expected)
                self.assertEqual(len(commands), 3)
                for command in commands[1:]:
                    self.assertIn('--redact=100', command)
                    self.assertIn('--report-path', command)

    def test_shallow_history_and_secret_scanner_errors_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(check.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='true')):
                with self.assertRaises(check.CheckError):
                    check.secrets(root, [], 'gitleaks', root)
            results = [subprocess.CompletedProcess([], 0, stdout='false'), subprocess.CompletedProcess([], 2)]
            with patch.object(check.subprocess, 'run', side_effect=results):
                with self.assertRaises(check.CheckError):
                    check.secrets(root, [], 'gitleaks', root)

    def test_cli_routes_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            args = ['--root', temporary, '--output', temporary]
            with patch.object(check, 'tracked_files', return_value=['.env']):
                self.assertEqual(check.main(['hygiene', *args]), 1)
            with patch.object(check, 'tracked_files', return_value=[]):
                self.assertEqual(check.main(['hygiene', *args]), 0)
                for command in ['dependencies', 'secrets']:
                    with patch.object(check, command, return_value=0):
                        self.assertEqual(check.main([command, *args]), 0)
            with patch.object(check, 'tracked_files', side_effect=OSError('unavailable')):
                self.assertEqual(check.main(['hygiene', *args]), 2)

    def test_git_inventory_supports_spaces_and_unicode(self):
        result = subprocess.CompletedProcess([], 0, stdout='a b\0żółć\0'.encode())
        with patch.object(check.subprocess, 'run', return_value=result):
            self.assertEqual(check.tracked_files(Path('.')), ['a b', 'żółć'])

    @unittest.skipUnless(os.environ.get('GITLEAKS_EXECUTABLE'), 'Install pinned Gitleaks for integration test')
    def test_real_scanner_detects_removed_history_secret_and_narrow_exception(self):
        executable = os.environ['GITLEAKS_EXECUTABLE']
        configuration = Path(__file__).resolve().parents[2] / '.gitleaks.toml'
        # Synthetic token is assembled in memory; no credential fixture is committed.
        synthetic = ''.join(('ghp_', 'ABcd12Ef34Gh56Ij78Kl90Mn12Op34Qr56St'))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
            git('init', '-q')
            git('config', 'user.name', 'Security fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            (root / '.gitleaks.toml').write_bytes(configuration.read_bytes())
            (root / 'fixture.txt').write_text('api_key = "' + synthetic + '"\n')
            git('add', '.')
            git('commit', '-qm', 'Synthetic history fixture')
            (root / 'fixture.txt').write_text('tokenPolicy: "utf8-conservative-v1"\n')
            git('add', '.')
            git('commit', '-qm', 'Remove synthetic token')
            output = root / 'reports'
            output.mkdir()
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(check.secrets(root, ['fixture.txt'], executable, output), 1)
            history = json.loads((output / 'secrets-history.json').read_text())
            self.assertTrue(history)
            self.assertTrue(all(finding['Secret'] == 'REDACTED' for finding in history))
            self.assertEqual(json.loads((output / 'secrets-tracked.json').read_text()), [])
            # Even the allowlisted field name cannot hide an actual access token.
            result = subprocess.run([executable, '--config', str(configuration), '--redact=100',
                                     '--no-banner', 'stdin'], input='tokenPolicy: "' + synthetic + '"',
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 1)
            (root / '.env').write_text('LOCAL_SETTING=example\n')
            git('add', '-f', '.env')
            self.assertIn('.env', check.forbidden_files(check.tracked_files(root)))


if __name__ == '__main__':
    unittest.main()

"""Test real temporary Git repositories, without executing analysis code."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import check_analysis_boundary as boundary


class AnalysisBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Security fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        (self.root / 'baseline.txt').write_text('audited implementation fixture')
        self.commit()
        self.baseline = self.git('rev-parse', 'HEAD').strip()
        for relative in (boundary.ADR, boundary.THREAT_MODEL):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('- Status: Accepted for the local execution contract; cloud execution deferred\n')
        self.review = {
            'schemaVersion': '1.0', 'decision': 'ACCEPTED_LOCAL', 'reviewedAt': '2026-10-07',
            'reviewer': 'Technical fixture reviewer', 'reviewKind': 'TECHNICAL_SELF_REVIEW',
            'auditedBaseline': self.baseline, 'cloudDecision': 'DEFERRED_PENDING_DEPLOYMENT_PARITY_REVIEW',
            'documents': self.hashes(),
        }
        self.write_review()
        self.commit()

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.root), *args], check=True,
                              capture_output=True, text=True).stdout

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture snapshot')

    def hashes(self):
        return {path: hashlib.sha256((self.root / path).read_bytes()).hexdigest()
                for path in (boundary.ADR, boundary.THREAT_MODEL)}

    def write_review(self):
        (self.root / boundary.REVIEW).write_text(json.dumps(self.review))

    def test_committed_accepted_policy_passes_and_cli_reports_local_scope(self):
        boundary.check_boundary(self.root)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(0, boundary.main(['--root', str(self.root)]))
        self.assertIn('cloud execution remains deferred', output.getvalue())

    def test_each_missing_uncommitted_or_linked_file_blocks(self):
        for relative in boundary.POLICY_PATHS:
            with self.subTest(relative=relative):
                path = self.root / relative
                original = path.read_bytes()
                path.unlink()
                with self.assertRaises(boundary.BoundaryError):
                    boundary.check_boundary(self.root)
                path.write_bytes(original + b' ')
                with self.assertRaisesRegex(boundary.BoundaryError, 'commit policy changes'):
                    boundary.check_boundary(self.root)
                path.unlink()
                path.symlink_to(self.root / 'baseline.txt')
                with self.assertRaises(boundary.BoundaryError):
                    boundary.check_boundary(self.root)
                path.unlink()
                path.write_bytes(original)

    def test_policy_added_without_commit_blocks(self):
        self.git('reset', '--mixed', self.baseline)
        with self.assertRaisesRegex(boundary.BoundaryError, 'committed HEAD'):
            boundary.check_boundary(self.root)

    def test_committed_policy_edits_need_a_new_matching_review(self):
        (self.root / boundary.THREAT_MODEL).write_text('changed policy')
        self.commit()
        with self.assertRaisesRegex(boundary.BoundaryError, 'stale'):
            boundary.check_boundary(self.root)
        self.review['documents'] = self.hashes()
        self.write_review()
        self.commit()
        boundary.check_boundary(self.root)

    def test_rejected_or_malformed_review_blocks(self):
        original = self.review.copy()
        invalid = [None, [], 'invalid', {}, dict(original, decision='PROPOSED'),
                   dict(original, schemaVersion='2.0'), dict(original, reviewer=' '),
                   dict(original, reviewer=42), dict(original, reviewedAt='not-a-date'),
                   dict(original, reviewKind='UNREVIEWED'), dict(original, cloudDecision='APPROVED'),
                   dict(original, auditedBaseline=None), dict(original, auditedBaseline='main'),
                   dict(original, documents={})]
        for review in invalid:
            with self.subTest(review=review):
                self.review = review
                self.write_review()
                self.commit()
                with self.assertRaises(boundary.BoundaryError):
                    boundary.check_boundary(self.root)
        (self.root / boundary.REVIEW).write_text('{')
        self.commit()
        with self.assertRaises(boundary.BoundaryError):
            boundary.check_boundary(self.root)

    def test_matching_hash_does_not_accept_proposed_adr(self):
        (self.root / boundary.ADR).write_text('- Status: Proposed\n')
        self.review['documents'] = self.hashes()
        self.write_review()
        self.commit()
        with self.assertRaises(boundary.BoundaryError):
            boundary.check_boundary(self.root)

    def test_reviewed_baseline_must_be_a_real_ancestor(self):
        self.review['auditedBaseline'] = 'a' * 40
        self.write_review()
        self.commit()
        with self.assertRaises(boundary.BoundaryError):
            boundary.check_boundary(self.root)

    def test_git_errors_and_timeouts_fail_closed(self):
        for error in (OSError('unavailable'), subprocess.TimeoutExpired('git', 10)):
            with patch.object(boundary.subprocess, 'run', side_effect=error):
                with self.assertRaises(boundary.BoundaryError):
                    boundary.check_boundary(self.root)
        with patch.object(Path, 'read_bytes', side_effect=OSError('unreadable')):
            with contextlib.redirect_stderr(io.StringIO()) as output:
                self.assertEqual(1, boundary.main(['--root', str(self.root)]))
            self.assertIn('RH-142 BLOCKED', output.getvalue())


if __name__ == '__main__':
    unittest.main()

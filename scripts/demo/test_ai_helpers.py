import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from api import ApiError, Client


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smoke = load_script('ai-smoke')
evaluation = load_script('evaluate-ai')


class LiveVerificationHelpersTest(unittest.TestCase):
    def test_retries_only_rejected_application_operations_with_a_bounded_window(self):
        client = smoke.SmokeClient('https://localhost:8443')
        failure = ApiError(429, '/synthetic', 'RATE_LIMIT_EXCEEDED', 12)
        with patch.object(Client, 'request', side_effect=[failure, ({'saved': True}, {}, 200)]) as request, patch.object(smoke.time, 'sleep') as sleep:
            self.assertEqual({'saved': True}, client.post('/synthetic', {'id': 'stable'}))
            self.assertEqual(request.call_args_list[0], request.call_args_list[1])
            sleep.assert_called_once_with(12)
        for failure in (ApiError(503, '/synthetic', 'AI_UNAVAILABLE'), ApiError(429, '/synthetic', 'RATE_LIMIT_EXCEEDED')):
            with patch.object(Client, 'request', side_effect=failure) as request, patch.object(smoke.time, 'sleep') as sleep:
                self.assertRaises(ApiError, client.post, '/synthetic')
                self.assertEqual(1, request.call_count)
                sleep.assert_not_called()

    def test_quota_retry_stops_after_three_admission_attempts(self):
        with patch.object(Client, 'request', side_effect=ApiError(429, '/synthetic', 'RATE_LIMIT_EXCEEDED', 1)) as request, patch.object(smoke.time, 'sleep') as sleep:
            self.assertRaises(ApiError, smoke.SmokeClient('https://localhost:8443').post, '/synthetic')
            self.assertEqual(3, request.call_count)
            self.assertEqual(2, sleep.call_count)

    def test_temporary_local_quota_is_restored_after_a_failed_live_check(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(smoke, 'STATE', Path(directory)), \
                patch.object(smoke.stack, 'managed_pid', return_value=123), patch.object(smoke.stack, 'credentials', return_value={'AI_WORKER_SERVICE_TOKEN': 'local'}), \
                patch.object(smoke.stack, 'stop_backend') as stop, patch.dict(os.environ, {'RESEARCHHUB_SECURITY_QUOTAS_WINDOW': 'PT1H'}):
            windows = []
            with patch.object(smoke.stack, 'start_backend', side_effect=lambda _: windows.append(os.environ['RESEARCHHUB_SECURITY_QUOTAS_WINDOW'])):
                with self.assertRaises(RuntimeError):
                    with smoke.local_quota_window():
                        raise RuntimeError('Synthetic verification failure')
            self.assertEqual(['PT1M', 'PT1H'], windows)
            self.assertEqual(2, stop.call_count)
            self.assertEqual('PT1H', os.environ['RESEARCHHUB_SECURITY_QUOTAS_WINDOW'])

    def test_host_evaluation_passes_private_settings_only_in_the_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            python = root / 'ai-worker/.venv/bin/python'
            python.parent.mkdir(parents=True)
            python.touch()
            with patch.object(evaluation, 'ROOT', root), patch.object(evaluation, 'STATE', root / '.demo'), \
                    patch.object(evaluation, 'worker_env', return_value={'GEMINI_API_KEY': 'synthetic-private'}), \
                    patch.object(evaluation.subprocess, 'run', return_value=Mock(returncode=1)) as run:
                self.assertEqual(1, evaluation.evaluate())
                self.assertEqual('synthetic-private', run.call_args.kwargs['env']['GEMINI_API_KEY'])
                self.assertNotIn('synthetic-private', repr(run.call_args.args))
                self.assertIn('--matrix', run.call_args.args[0])

    def test_container_evaluation_copies_the_report_and_cleans_up_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            matrix = root / 'docs/evaluation/models/demo-matrix.json'
            matrix.parent.mkdir(parents=True)
            matrix.write_text('{"public":true}')
            with patch.object(evaluation, 'ROOT', root), patch.object(evaluation, 'STATE', root / '.demo'), \
                    patch.object(evaluation, 'compose', return_value=['docker', 'compose']), \
                    patch.object(evaluation.subprocess, 'run', side_effect=[Mock(returncode=1), OSError('Synthetic copy failure'), Mock(returncode=0)]) as run:
                self.assertRaises(OSError, evaluation.evaluate)
                calls = run.call_args_list
                self.assertEqual('{"public":true}', calls[0].kwargs['input'])
                self.assertIn('cp', calls[1].args[0])
                self.assertIn('shutil.rmtree', calls[2].args[0][-2])


if __name__ == '__main__':
    unittest.main()

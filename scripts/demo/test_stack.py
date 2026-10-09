import contextlib
import io
import json
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import stack


class DemoStackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / ".demo/local"
        self.state.mkdir(parents=True)
        self.patches = [patch.object(stack, "ROOT", self.root), patch.object(stack, "STATE", self.state),
                        patch.object(stack, "JAR", self.root / "backend/target/backend-0.0.1-SNAPSHOT.jar")]
        for item in self.patches: item.start()
        self.addCleanup(self.temp.cleanup)
        for item in self.patches: self.addCleanup(item.stop)

    def save(self, name, value):
        (self.state / name).write_text(json.dumps(value))

    def accounts(self):
        return {"accounts": {slug: {"email": slug+"@example.test", "password": "synthetic-test-password"}
                             for slug in ("demo-editor", "collaboration-editor")}}

    def test_credentials_are_private_stable_and_never_regenerated(self):
        first = stack.credentials()
        self.assertEqual(4, len(first))
        self.assertEqual(first, stack.credentials())
        self.assertEqual(0o600, (self.state / "demo.env").stat().st_mode & 0o777)
        self.assertEqual(4, len(set(first.values())))

    def test_compose_uses_linux_loopback_override_only_on_linux(self):
        with patch.object(stack.platform, "system", return_value="Linux"):
            self.assertIn("infra/demo/compose.demo.linux.yaml", stack.compose())
        with patch.object(stack.platform, "system", return_value="Darwin"):
            self.assertNotIn("infra/demo/compose.demo.linux.yaml", stack.compose())

    def test_fingerprint_changes_with_content_and_is_stable_for_sorted_paths(self):
        (self.root / "src").mkdir(); (self.root / "src/a").write_text("one")
        (self.root / "file").write_text("two")
        first = stack.fingerprint(["src", "file"])
        self.assertEqual(first, stack.fingerprint(["file", "src"]))
        (self.root / "src/a").write_text("changed")
        self.assertNotEqual(first, stack.fingerprint(["src", "file"]))

    def test_run_respects_component_working_directory(self):
        with patch.object(stack.subprocess, "run") as run:
            stack.run(["maven"], cwd="backend")
            run.assert_called_once_with(["maven"], cwd="backend", check=True)

    def test_builds_missing_components_once_and_preserves_successful_stamps(self):
        stack.JAR.parent.mkdir(parents=True)
        stack.JAR.write_text("jar")
        (self.root / "frontend/dist").mkdir(parents=True)
        (self.root / "frontend/dist/index.html").write_text("frontend")
        assets = self.root / "frontend/dist/assets"
        assets.mkdir(mode=0o700)
        (assets / "app.js").write_text("public bundle")
        (assets / "app.js").chmod(0o600)
        with patch.object(stack, "fingerprint", return_value="hash"), patch.object(stack, "run") as run, \
             patch.object(stack.subprocess, "run", return_value=Mock(returncode=1)):
            stack.build()
            self.assertTrue(any("sandbox" in call.args[0] for call in run.call_args_list))
            self.assertTrue(any("ci" in call.args[0] for call in run.call_args_list))
            self.assertTrue(all(call.kwargs["umask"] == 0o022 for call in run.call_args_list if call.args[0][0] == "npm"))
            self.assertEqual(0o755, assets.stat().st_mode & 0o777)
            self.assertEqual(0o644, (assets / "app.js").stat().st_mode & 0o777)
        with patch.object(stack, "fingerprint", return_value="hash"), patch.object(stack, "run") as run, \
             patch.object(stack.subprocess, "run", return_value=Mock(returncode=0)):
            stack.build(); run.assert_not_called()

    def test_pid_reuse_does_not_kill_an_unrelated_process(self):
        self.assertIsNone(stack.managed_pid())
        (self.state / "backend.pid").write_text("123")
        with patch.object(stack.subprocess, "run", return_value=Mock(returncode=0, stdout="unrelated application")):
            self.assertIsNone(stack.managed_pid())
        with patch.object(stack.subprocess, "run", return_value=Mock(returncode=0, stdout=str(stack.JAR)+" --researchhub.demo.process=local")):
            self.assertEqual(123, stack.managed_pid())

    def test_stop_targets_only_managed_pid_and_escalates_a_stuck_backend(self):
        with patch.object(stack, "managed_pid", side_effect=[123, None]), patch.object(stack.os, "kill") as kill:
            stack.stop_backend(); kill.assert_called_once_with(123, signal.SIGTERM)
        with patch.object(stack, "managed_pid", return_value=123), patch.object(stack.os, "kill") as kill, patch.object(stack.time, "sleep"):
            stack.stop_backend(); self.assertEqual(signal.SIGKILL, kill.call_args.args[1])
        with patch.object(stack, "managed_pid", return_value=None), patch.object(stack.os, "kill") as kill:
            stack.stop_backend(); kill.assert_not_called()

    def test_backend_requires_local_docker_and_safe_effective_configuration(self):
        with patch.dict(stack.os.environ, {"DOCKER_HOST": "unix:///tmp/docker.sock"}), patch.object(stack.subprocess, "run"):
            seeding = stack.backend_env({"DEMO_DB_PASSWORD": "test"}, True)
            final = stack.backend_env({"DEMO_DB_PASSWORD": "test"}, False)
        self.assertEqual("127.0.0.1", final["SERVER_ADDRESS"])
        self.assertEqual("disabled", final["REGISTRATION_MODE"])
        self.assertEqual("open", seeding["REGISTRATION_MODE"])
        self.assertEqual("/tmp/docker.sock", final["ANALYSIS_SANDBOX_SOCKET_PATH"])
        with patch.dict(stack.os.environ, {"DOCKER_HOST": "tcp://remote:2375"}):
            self.assertRaises(RuntimeError, stack.backend_env, {"DEMO_DB_PASSWORD": "test"}, False)
        with patch.dict(stack.os.environ, {"DOCKER_HOST": ""}), patch.object(stack.subprocess, "run", return_value=Mock(stdout="unix:///tmp/context.sock\n")):
            self.assertEqual("/tmp/context.sock", stack.backend_env({"DEMO_DB_PASSWORD": "test"}, False)["ANALYSIS_SANDBOX_SOCKET_PATH"])

    def test_one_key_private_dotenv_auto_selection_and_secret_isolation(self):
        (self.root / '.env').write_text('# private\nGEMINI_API_KEY="private-key"\nGEMINI_MODEL=gemini-3.8-flash\nDB_PASSWORD=ignored\n')
        with patch.dict(stack.os.environ, {}, clear=True):
            settings = stack.worker_env({'DEMO_DB_PASSWORD': 'db'})
            self.assertEqual('gemini', stack.selected_provider(settings, 'AI_WORKER_MODEL_PROVIDER'))
            self.assertEqual('private-key', settings['GEMINI_API_KEY'])
            self.assertNotIn('DB_PASSWORD', settings)
            seeded = stack.worker_env(seeding=True)
            self.assertNotIn('GEMINI_API_KEY', seeded)
            self.assertEqual('deterministic', seeded['AI_WORKER_EMBEDDING_PROVIDER'])
        with patch.dict(stack.os.environ, {'GEMINI_API_KEY': 'process-key', 'AI_WORKER_MODEL_PROVIDER': 'deterministic'}, clear=True):
            self.assertEqual('process-key', stack.worker_env()['GEMINI_API_KEY'])
            self.assertEqual('deterministic', stack.selected_provider(stack.worker_env(), 'AI_WORKER_MODEL_PROVIDER'))
        with patch.dict(stack.os.environ, {'DOCKER_HOST': 'unix:///tmp/docker.sock', 'GEMINI_API_KEY': 'process-key'}):
            result = stack.backend_env({'DEMO_DB_PASSWORD': 'db', 'FOUNDRY_API_KEY': 'private-foundry'}, False)
            self.assertNotIn('GEMINI_API_KEY', result)
            self.assertNotIn('FOUNDRY_API_KEY', result)
        (self.root / '.env').write_text('GEMINI_API_KEY="unterminated\n')
        self.assertRaises(RuntimeError, stack.worker_env)

    def test_reprocessing_records_model_identity_after_ready_and_is_idempotent(self):
        self.save('accounts.json', {'accounts': {'owner': {'email': 'owner', 'password': 'synthetic'}}})
        self.save('seed-manifest.json', {'workspaceId': 'workspace'})
        profile = {'provider': 'gemini', 'name': 'embedding', 'version': '1', 'dimension': 768}
        source = {'id': 'source', 'activeVersionId': 'version', 'status': 'READY'}
        client = Mock()
        client.get.side_effect = [[source], source]
        response = Mock(__enter__=Mock(return_value=io.StringIO(json.dumps(profile))), __exit__=Mock())
        with patch('api.Client', return_value=client) as factory, patch.object(stack.urllib.request, 'urlopen', return_value=response), patch.object(stack.ssl, 'create_default_context'), patch.object(stack, 'wait_health'), contextlib.redirect_stdout(io.StringIO()):
            stack.reindex_demo({'AI_WORKER_SERVICE_TOKEN': 'service-token'}, {'GEMINI_API_KEY': 'key'})
            self.assertEqual(profile, json.loads((self.state / 'embedding-profile.json').read_text()))
            client.post.assert_called_once_with('/api/workspaces/workspace/sources/source/reprocess')
            self.assertEqual(stack.URL, factory.call_args.args[0])
        response = Mock(__enter__=Mock(return_value=io.StringIO(json.dumps(profile))), __exit__=Mock())
        with patch('api.Client') as client, patch.object(stack.urllib.request, 'urlopen', return_value=response):
            stack.reindex_demo({'AI_WORKER_SERVICE_TOKEN': 'token'}, {'GEMINI_API_KEY': 'key'})
            client.assert_not_called()

    def test_reprocessing_resumes_completed_sources_and_does_not_mark_failure_ready(self):
        self.save('accounts.json', {'accounts': {'owner': {'email': 'owner', 'password': 'synthetic'}}})
        self.save('seed-manifest.json', {'workspaceId': 'workspace'})
        profile = {'provider': 'gemini', 'name': 'embedding', 'version': '1', 'dimension': 768}
        self.save('embedding-reprocessing.json', {'profile': profile, 'completed': {'done': 'version'}})
        sources = [{'id': 'done', 'activeVersionId': 'version', 'status': 'READY'},
                   {'id': 'pending', 'activeVersionId': 'other', 'status': 'PROCESSING'}]
        client = Mock()
        client.get.side_effect = [sources, {**sources[1], 'status': 'READY'}, {**sources[1], 'status': 'FAILED'}]
        response = Mock(__enter__=Mock(return_value=io.StringIO(json.dumps(profile))), __exit__=Mock())
        with patch('api.Client', return_value=client), patch.object(stack.urllib.request, 'urlopen', return_value=response), patch.object(stack.ssl, 'create_default_context'), patch.object(stack, 'wait_health'), contextlib.redirect_stdout(io.StringIO()):
            self.assertRaises(RuntimeError, stack.reindex_demo, {'AI_WORKER_SERVICE_TOKEN': 'token'}, {'GEMINI_API_KEY': 'key'})
            client.post.assert_called_once_with('/api/workspaces/workspace/sources/pending/reprocess')
            self.assertFalse((self.state / 'embedding-profile.json').exists())

    def test_readiness_is_bounded_and_tolerates_startup_failures(self):
        with patch.object(stack.urllib.request, "urlopen", side_effect=[stack.urllib.error.URLError("starting"), Mock(__enter__=Mock(return_value=Mock(status=200)), __exit__=Mock())]), patch.object(stack.time, "sleep"):
            stack.wait_health("http://test")
        with patch.object(stack.time, "monotonic", side_effect=[0, 181]):
            self.assertRaises(RuntimeError, stack.wait_health, "http://test")

    def test_backend_launch_is_detached_and_seeding_is_loopback_only(self):
        with patch.object(stack, "backend_env", return_value={}), patch.object(stack.subprocess, "Popen", return_value=Mock(pid=123)) as popen, patch.object(stack, "wait_health"):
            stack.start_backend({}, True)
            self.assertIn("--server.servlet.session.cookie.secure=false", popen.call_args.args[0])
            self.assertTrue(popen.call_args.kwargs["start_new_session"])
            stack.start_backend({}, False)
            self.assertNotIn("--server.servlet.session.cookie.secure=false", popen.call_args.args[0])

    def test_up_seeds_once_then_reuses_running_stack_without_destructive_commands(self):
        self.save("accounts.json", self.accounts())
        with patch.object(stack.shutil, "which", return_value="tool"), patch.object(stack, "credentials", return_value={}), \
             patch.object(stack, "build"), patch.object(stack, "run") as run, patch.object(stack, "start_backend") as start, \
             patch.object(stack, "stop_backend") as stop, patch.object(stack, "managed_pid", return_value=123), \
             patch.object(stack, "fingerprint", return_value="hash"), patch.object(stack, "smoke"), contextlib.redirect_stdout(io.StringIO()):
            stack.up()
            self.assertEqual([True, False], [call.kwargs.get("seeding", False) for call in start.call_args_list])
            self.assertTrue(any("scripts/demo/seed.py" in call.args[0] for call in run.call_args_list))
            self.save("seed-manifest.json", {})
            run.reset_mock(); start.reset_mock(); stop.reset_mock()
            stack.up(); start.assert_not_called(); stop.assert_not_called()
            self.assertFalse(any("down" in call.args[0] or "scripts/demo/seed.py" in call.args[0] for call in run.call_args_list))

    def test_failed_seed_always_stops_open_registration_backend(self):
        with patch.object(stack.shutil, "which", return_value="tool"), patch.object(stack, "credentials", return_value={}), \
             patch.object(stack, "build"), patch.object(stack, "run"), patch.object(stack, "start_backend", side_effect=RuntimeError("failed")), patch.object(stack, "stop_backend") as stop:
            self.assertRaises(RuntimeError, stack.up)
            self.assertEqual(2, stop.call_count)
        with patch.object(stack.shutil, "which", return_value=None):
            self.assertRaises(RuntimeError, stack.up)

    def test_down_preserves_accounts_but_explicit_reset_removes_baseline_and_volumes(self):
        self.save("accounts.json", self.accounts())
        stack.credentials()
        with patch.object(stack, "stop_backend"), patch.object(stack, "run") as run:
            stack.down(); self.assertTrue((self.state / "accounts.json").exists())
            self.assertNotIn("-v", run.call_args.args[0])
            stack.down(reset=True); self.assertFalse((self.state / "accounts.json").exists())
            self.assertIn("-v", run.call_args.args[0])

    def test_smoke_proves_real_seeded_execution_and_closed_registration(self):
        self.save("accounts.json", self.accounts())
        self.save("seed-manifest.json", dict(workspaceId="w", documentId="d", analysisId="a", executionId="e"))
        client = Mock()
        facts = dict(demo=True, registrationMode="disabled", ai={"mode": "deterministic"})
        record = dict(execution={"status": "SUCCEEDED"}, charts=[{}])
        with patch("api.Client", return_value=client), patch.object(stack.ssl, "create_default_context"), patch.object(stack, "wait_health"), contextlib.redirect_stdout(io.StringIO()):
            client.get.side_effect = [facts, {}, record]
            stack.smoke(); client.login.assert_called_once(); self.assertEqual((403,), client.post.call_args.kwargs["expected"])
            client.get.side_effect = [{**facts, "registrationMode": "open"}]
            self.assertRaises(RuntimeError, stack.smoke)
            client.get.side_effect = [facts, {}, {"execution": {"status": "FAILED"}, "charts": []}]
            self.assertRaises(RuntimeError, stack.smoke)

    def test_main_serializes_up_down_reset_and_smoke(self):
        with patch.object(stack, "up") as up, patch.object(stack, "down") as down, patch.object(stack, "smoke") as smoke:
            for action in ("up", "down", "reset", "smoke"): stack.main(action)
            self.assertEqual(2, up.call_count); self.assertEqual(2, down.call_count); smoke.assert_called_once()
            self.assertRaises(ValueError, stack.main, "invalid")


if __name__ == "__main__": unittest.main()

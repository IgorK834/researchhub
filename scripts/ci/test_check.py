"""Regression tests for job selection and fail-closed CI validation."""

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import check


class CiChecksTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def file(self, name, content=""):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def optional_components(self):
        self.file("infra/azure/main.bicep")
        self.file("performance/k6/smoke.js")

    def test_documentation_only_skips_all_heavy_jobs(self):
        self.optional_components()
        selected = check.select_jobs(["docs/development/ci.md", "README.md", "backend/README.md", "ai-worker/README.md"], self.root)
        self.assertEqual({job for job, enabled in selected.items() if enabled}, {"docs"})

    def test_documentation_assets_run_link_check(self):
        selected = check.select_jobs(["docs/images/screenshot.png"], self.root)
        self.assertEqual({job for job, enabled in selected.items() if enabled}, {"docs"})

    def test_component_and_cross_component_dependencies(self):
        expected = {
            "backend/src/example.java": {"backend", "regression"},
            "frontend/src/example.ts": {"frontend", "regression"},
            "ai-worker/src/example.py": {"backend", "ai-worker", "regression"},
            "collaboration/src/example.ts": {"backend", "collaboration", "regression"},
            "sandbox/runtime/run.py": {"backend", "sandbox", "regression"},
            "contracts/processing/request.json": {"backend", "frontend", "ai-worker", "collaboration", "regression"},
            "compose.yaml": {"backend", "regression"},
            ".env.example": {"backend", "regression"},
            "scripts/security/check.py": {"scripts", "dependencies"},
            "ai-worker/scripts/check.sh": {"backend", "ai-worker", "scripts", "regression"},
            ".gitleaks.toml": {"dependencies"},
        }
        for path, jobs in expected.items():
            with self.subTest(path=path):
                selected = check.select_jobs([path], self.root)
                self.assertEqual({job for job, enabled in selected.items() if enabled}, jobs)

    def test_new_and_existing_dependency_inventories(self):
        for name in ("pom.xml", "package.json", "package-lock.json", "pyproject.toml", "uv.lock", "requirements.lock", "requirements.txt"):
            with self.subTest(name=name):
                self.assertTrue(check.select_jobs([f"new-component/{name}"], self.root)["dependencies"])
        selected = check.select_jobs(["ai-worker/uv.lock"], self.root)
        self.assertTrue(selected["sandbox"])
        self.assertTrue(selected["dependencies"])

    def test_filters_do_not_match_similarly_named_paths(self):
        selected = check.select_jobs(["frontend-old/app.ts", "compose.yaml.backup", "backendish/pom.txt"], self.root)
        self.assertFalse(any(selected.values()))

    def test_missing_optional_components_skip_even_full_runs(self):
        selected = check.select_jobs([], self.root, full=True)
        self.assertFalse(selected.pop("infra"))
        self.assertFalse(selected.pop("performance"))
        self.assertTrue(all(selected.values()))

    def test_optional_components_and_workflow_changes(self):
        self.optional_components()
        for path in (".github/workflows/ci.yml", "scripts/ci/check.py"):
            self.assertTrue(all(check.select_jobs([path], self.root).values()))
        self.assertTrue(all(check.select_jobs([], self.root, full=True).values()))
        for path, job in (("infra/azure/main.bicep", "infra"), ("performance/k6/smoke.js", "performance")):
            selected = check.select_jobs([path], self.root)
            self.assertEqual({name for name, enabled in selected.items() if enabled}, {job})
        (self.root / "performance/k6/smoke.js").unlink()
        self.assertFalse(check.select_jobs(["performance/k6/smoke.js"], self.root)["performance"])

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], stderr=subprocess.PIPE).decode().strip()

    def test_real_git_diff_includes_renames_deletions_and_over_300_files(self):
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "CI fixture")
        self.git("config", "user.email", "ci@example.test")
        self.file("docs/old.md", "documentation")
        self.file("frontend/deleted.ts", "old code")
        self.git("add", ".")
        self.git("commit", "-m", "base fixture")
        base = self.git("rev-parse", "HEAD")
        self.git("switch", "-c", "fixture")
        self.file("backend/renamed.java", "documentation")
        (self.root / "docs/old.md").unlink()
        (self.root / "frontend/deleted.ts").unlink()
        for index in range(301):
            self.file(f"docs/file-{index}.md")
        self.git("add", ".")
        self.git("commit", "-m", "changed fixture")
        head = self.git("rev-parse", "HEAD")
        event = {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}
        real_run = subprocess.run
        with patch.object(check.subprocess, "run", wraps=real_run) as run:
            # changed_paths runs in the checked-out workspace in Actions.
            run.side_effect = lambda *args, **kwargs: real_run(*args, cwd=self.root, **kwargs)
            paths = check.changed_paths(event)
        self.assertEqual(len(paths), 304)
        self.assertIn("docs/old.md", paths)
        selected = check.select_jobs(paths, self.root)
        self.assertTrue(selected["backend"])
        self.assertTrue(selected["frontend"])
        self.assertTrue(selected["docs"])

    def test_invalid_commit_sha_and_failed_diff_fail_closed(self):
        event = {"pull_request": {"base": {"sha": "--bad-ref"}, "head": {"sha": "b" * 40}}}
        with self.assertRaises(ValueError):
            check.changed_paths(event)
        event["pull_request"]["base"]["sha"] = "a" * 40
        with patch.object(check.subprocess, "run", side_effect=subprocess.CalledProcessError(128, "git")):
            with self.assertRaises(subprocess.CalledProcessError):
                check.changed_paths(event)

    def test_actions_outputs_and_full_events(self):
        event = self.file("event.json", "{}")
        output = self.file("output", "existing=true\n")
        environment = {"GITHUB_EVENT_PATH": str(event), "GITHUB_OUTPUT": str(output)}
        for event_name in ("pull_request", "push", "schedule", "workflow_dispatch"):
            environment["GITHUB_EVENT_NAME"] = event_name
            with patch.dict(os.environ, environment), patch.object(check, "changed_paths", return_value=["README.md"]), contextlib.redirect_stdout(io.StringIO()):
                check.changes(self.root)
            lines = output.read_text().splitlines()
            self.assertIn("docs=true", lines)
            self.assertIn(f"backend={str(event_name != 'pull_request').lower()}", lines[-len(check.FILTERS) - 1:])
        environment["GITHUB_EVENT_NAME"] = "pull_request_target"
        with patch.dict(os.environ, environment), self.assertRaises(ValueError):
            check.changes(self.root)
        self.assertTrue(output.read_text().startswith("existing=true\n"))

    def test_infra_builds_lints_and_checks_parameter_files(self):
        bicep = self.file("infra/azure/modules/main.bicep")
        parameters = self.file("infra/azure/main.bicepparam")
        with patch.object(check.subprocess, "run") as run:
            check.validate(self.root, "infra")
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ["az", "bicep", "build", "--file", str(bicep), "--stdout"],
            ["az", "bicep", "lint", "--file", str(bicep)],
            ["az", "bicep", "build-params", "--file", str(parameters), "--stdout"],
        ])
        self.assertTrue(all(call.kwargs["check"] for call in run.call_args_list))

    def test_broken_bicep_build_lint_or_parameters_fail_the_validator(self):
        self.optional_components()
        self.file("infra/azure/main.bicepparam")
        for successful_commands in range(3):
            with self.subTest(successful_commands=successful_commands):
                with patch.object(check.subprocess, "run", side_effect=[None] * successful_commands + [subprocess.CalledProcessError(1, "az")]):
                    with self.assertRaises(subprocess.CalledProcessError):
                        check.validate(self.root, "infra")

    def test_performance_inspects_all_top_level_scripts(self):
        first = self.file("performance/k6/a.js")
        second = self.file("performance/k6/b.js")
        self.file("performance/k6/data/fixture.json")
        with patch.object(check.subprocess, "run") as run:
            check.validate(self.root, "performance")
        self.assertEqual([call.args[0] for call in run.call_args_list], [["k6", "inspect", str(first)], ["k6", "inspect", str(second)]])
        self.assertTrue(all(call.kwargs["check"] for call in run.call_args_list))
        with patch.object(check.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "k6")):
            with self.assertRaises(subprocess.CalledProcessError):
                check.validate(self.root, "performance")

    def test_shellcheck_includes_extensionless_scripts_and_ignores_python(self):
        names = ["scripts/a.sh", "scripts/nested/run", "scripts/check.py", "ai-worker/scripts/check.sh"]
        for name, content in zip(names, ("echo ok", "#!/usr/bin/env bash\necho ok", "#!/usr/bin/env python3", "#!/bin/sh")):
            self.file(name, content)
        result = subprocess.CompletedProcess([], 0, stdout=("\0".join(names) + "\0").encode())
        with patch.object(check.subprocess, "run", return_value=result) as run:
            check.validate(self.root, "scripts")
        self.assertEqual([call.args[0] for call in run.call_args_list[1:]], [["shellcheck", str(self.root / name)] for name in (names[0], names[1], names[3])])
        with patch.object(check.subprocess, "run", side_effect=[result, subprocess.CalledProcessError(1, "shellcheck")]):
            with self.assertRaises(subprocess.CalledProcessError):
                check.validate(self.root, "scripts")

    def test_optional_validators_with_no_sources(self):
        with patch.object(check.subprocess, "run") as run:
            check.validate(self.root, "infra")
            check.validate(self.root, "performance")
        run.assert_not_called()

    def test_gate_accepts_optional_skips_and_rejects_failures_and_cancellation(self):
        with contextlib.redirect_stdout(io.StringIO()):
            check.gate({"changes": {"result": "success"}, "backend": {"result": "skipped"}, "docs": {"result": "success"}})
        for result in ("failure", "cancelled", "pending"):
            with self.subTest(result=result), self.assertRaises(ValueError):
                check.gate({"changes": {"result": "success"}, "backend": {"result": result}})
        for needs in ({}, {"changes": {"result": "skipped"}}, {"changes": {"result": "failure"}}):
            with self.assertRaises(ValueError):
                check.gate(needs)

    def test_command_line_dispatch(self):
        for kind, handler in (("changes", "changes"), ("gate", "gate"), ("infra", "validate"), ("performance", "validate"), ("scripts", "validate")):
            with patch("sys.argv", ["check.py", kind]), patch.dict(os.environ, {"NEEDS_JSON": "{}"}), patch.object(check, handler) as run:
                check.main()
                run.assert_called_once()


if __name__ == "__main__":
    unittest.main()

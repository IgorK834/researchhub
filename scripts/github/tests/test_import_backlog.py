"""Run the complete Bash importer offline against a stateful fake gh."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/github/import-vps-backlog.sh"
AUDIT = ROOT / "docs/backlog/vps-product-audit-2026-10-13.md"
MOCK = Path(__file__).parent / "fixtures/gh"
SOURCE = SCRIPT.read_text()
TASK_IDS = re.findall(r'^if should_create_issue "(\d+\.\d+)"; then$', SOURCE, re.MULTILINE)
MILESTONES = re.findall(r'^validate_milestone "\d+" "([^"]+)"$', SOURCE, re.MULTILINE)
REUSED = {"3.21": 227, "24.6": 234, "24.7": 235, "25.3": 144, "26.3": 149, "28.3": 204, "28.6": 207, "28.7": 208, "28.10": 211, "30.5": 223, "30.6": 224}


class ImportBacklogTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="researchhub-backlog-test-")
        self.folder = Path(self.temporary.name)
        self.bin = self.folder / "bin"
        self.bin.mkdir()
        shutil.copyfile(MOCK, self.bin / "gh")
        (self.bin / "gh").chmod(0o700)
        self.state_path = self.folder / "state.json"
        self.events_path = self.folder / "events.jsonl"
        self.seed()

    def tearDown(self):
        self.temporary.cleanup()

    def seed(self, issues=None, milestones=None):
        self.state_path.write_text(json.dumps({"issues": issues or [], "milestones": milestones or [], "labels": {}}))
        self.events_path.write_text("")

    def seed_audited(self):
        self.seed(
            issues=[{"number": number, "state": "open", "title": f"[Task {task}] Istniejący oryginalny tytuł"} for task, number in REUSED.items()],
            milestones=[{"number": index + 1, "state": "open", "title": name} for index, name in enumerate(MILESTONES) if int(name.split(":")[0].split()[1]) < 31],
        )

    def run_import(self, *arguments, **extra_env):
        env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "GH_MOCK_STATE": str(self.state_path), "GH_MOCK_EVENTS": str(self.events_path), **extra_env}
        return subprocess.run(["/bin/bash", str(SCRIPT), *arguments], env=env, text=True, capture_output=True, timeout=60)

    def events(self, kind=None):
        items = [json.loads(line) for line in self.events_path.read_text().splitlines()]
        return [item for item in items if kind is None or item["kind"] == kind]

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout[-2000:])

    def test_bash_32_syntax_and_single_line_template(self):
        result = subprocess.run(["/bin/bash", "-n", str(SCRIPT)], capture_output=True, text=True)
        self.assert_success(result)
        commands = [line.strip() for line in SOURCE.splitlines() if line.strip().startswith("gh issue create")]
        self.assertEqual(len(commands), 61)
        self.assertEqual(len(re.findall(r'^gh label create .+ --color "#[0-9a-f]{6}"', SOURCE, re.MULTILINE)), 27)
        self.assertEqual(len(TASK_IDS), len(set(TASK_IDS)))
        self.assertNotIn("<<", SOURCE)
        self.assertFalse(any(line.rstrip().endswith("\\") for line in SOURCE.splitlines()))
        for line in commands:
            self.assertRegex(line, r'gh issue create --title "\[Task \d+\.\d+\] .+" --milestone "Epic \d+: .+" --label ".+" --body \$\'.+\'')
            self.assertIn("\\n", line)

    def test_all_61_bodies_labels_milestones_and_dependencies(self):
        result = self.run_import()
        self.assert_success(result)
        self.assertEqual(len(self.events("issue")), 61)
        self.assertEqual(len(self.events("milestone")), 13)
        self.assertEqual(len(self.events("label")), 27)
        all_ids = set(re.findall(r"\[Task (\d+\.\d+)\]", AUDIT.read_text())) | set(TASK_IDS)
        graph = {}
        for issue in self.events("issue"):
            task = re.match(r"\[Task (\d+\.\d+)\]", issue["title"]).group(1)
            body = issue["body"]
            self.assertGreater(len(body), 1800, task)
            self.assertEqual(re.findall(r"^### (.+)$", body, re.MULTILINE), ["Objective", "Technical Implementation Details", "Acceptance Criteria", "Dependencies"])
            self.assertNotIn("\\n", body, task)
            self.assertIn("- [ ] Minimum 80% test coverage for this module", body)
            self.assertGreaterEqual(body.count("- [ ]"), 6)
            self.assertIn("**Ścieżki implementacji", body)
            self.assertIn("**Technologie i wersje", body)
            self.assertGreaterEqual(len(issue["labels"]), 3)
            self.assertEqual(len([label for label in issue["labels"] if label.endswith("-priority")]), 1)
            self.assertEqual(len([label for label in issue["labels"] if label.startswith("epic:")]), 1)
            self.assertTrue(issue["milestone"].startswith(f"Epic {task.split('.')[0]}:"))
            dependencies = re.findall(r"Task (\d+\.\d+)", body.split("### Dependencies\n\n")[1])
            self.assertTrue(set(dependencies) <= all_ids, task)
            graph[task] = dependencies
        visiting, visited = set(), set()

        def visit(task):
            self.assertNotIn(task, visiting, f"Dependency cycle at {task}")
            if task in visited:
                return
            visiting.add(task)
            for dependency in graph.get(task, []):
                if dependency in graph:
                    visit(dependency)
            visiting.remove(task)
            visited.add(task)

        for task in graph:
            visit(task)
        colors = [event["color"] for event in self.events("label") if event["name"].startswith("epic:")]
        self.assertEqual(len(colors), len(set(colors)))

    def test_audited_snapshot_creates_50_and_reuses_11(self):
        self.seed_audited()
        before = json.loads(self.state_path.read_text())["issues"]
        result = self.run_import()
        self.assert_success(result)
        self.assertEqual(len(self.events("issue")), 50)
        self.assertEqual(len(self.events("milestone")), 7)
        self.assertIn("50 zadań utworzono, 11 istniejących pominięto", result.stdout)
        self.assertEqual(json.loads(self.state_path.read_text())["issues"][:11], before)

    def test_second_import_is_idempotent(self):
        self.assert_success(self.run_import())
        issues = len(self.events("issue"))
        milestones = len(self.events("milestone"))
        result = self.run_import()
        self.assert_success(result)
        self.assertEqual(len(self.events("issue")), issues)
        self.assertEqual(len(self.events("milestone")), milestones)
        self.assertIn("0 zadań utworzono, 61 istniejących pominięto", result.stdout)

    def test_closed_issue_is_skipped_by_id_even_with_different_title(self):
        self.seed(issues=[{"number": 900, "state": "closed", "title": "[Task 31.1] Stary, zupełnie inny tytuł"}, {"number": 901, "state": "open", "title": "[Task 31.10] Istniejąca walidacja"}])
        result = self.run_import()
        self.assert_success(result)
        self.assertEqual(len(self.events("issue")), 59)
        self.assertIn("#900 (closed)", result.stdout)
        self.assertTrue(any("[Task 31.2]" in item["title"] for item in self.events("issue")))

    def test_dry_run_never_mutates_remote_state(self):
        self.seed_audited()
        before = self.state_path.read_text()
        result = self.run_import("--dry-run")
        self.assert_success(result)
        self.assertEqual(self.events(), [])
        self.assertEqual(self.state_path.read_text(), before)
        self.assertIn("50 zadań zaplanowano, 11 istniejących pominięto", result.stdout)
        self.assertIn("[DRY-RUN]", result.stdout)

    def test_conflicting_epic_stops_before_any_mutation(self):
        self.seed(milestones=[{"number": 31, "state": "open", "title": "Epic 31: Inny zakres"}])
        result = self.run_import()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Konflikt numeracji Epic 31", result.stderr)
        self.assertEqual(self.events(), [])

    def test_closed_milestone_stops_before_any_mutation(self):
        self.seed(milestones=[{"number": 31, "state": "closed", "title": "Epic 31: Wdrożenie demo na VPS"}])
        result = self.run_import()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("jest zamknięty", result.stderr)
        self.assertEqual(self.events(), [])

    def test_resume_after_create_failure_never_duplicates_tasks(self):
        first = self.run_import(GH_MOCK_FAIL_TASK="31.3")
        self.assertNotEqual(first.returncode, 0)
        self.assertIn("Import przerwany", first.stderr)
        self.assertGreater(len(self.events("issue")), 0)
        self.assert_success(self.run_import())
        self.assertEqual(len(self.events("issue")), 61)
        self.assertEqual(len(self.events("milestone")), 13)

    def test_explicit_repository_uses_gh_repo_for_every_mutation(self):
        self.assert_success(self.run_import("--repo", "ExampleOwner/example-repo", GH_MOCK_RESOLVED="exampleowner/EXAMPLE-REPO"))
        self.assertTrue(all(item["repo"] == "ExampleOwner/example-repo" for item in self.events()))

    def test_mismatched_repository_is_rejected(self):
        result = self.run_import(GH_MOCK_RESOLVED="OtherOwner/other-repo")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Nieoczekiwane repozytorium", result.stderr)
        self.assertEqual(self.events(), [])

    def test_invalid_arguments_and_help_do_not_call_github(self):
        for arguments in [("--repo",), ("--repo", "bad"), ("--unknown",)]:
            result = self.run_import(*arguments)
            self.assertEqual(result.returncode, 2)
        self.assert_success(self.run_import("--help"))
        self.assertEqual(self.events(), [])


if __name__ == "__main__":
    unittest.main()

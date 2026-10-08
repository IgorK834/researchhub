import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import generate_fixtures as fixtures
import seed
from api import ApiError, save_private, wait_for

class FakeRest:
    def __init__(self, fail=None):
        self.fail = fail
        self.workspaces = []
        self.members = []
        self.sources = []
        self.documents = []
        self.analyses = []
        self.executions = []
        self.comments = []
        self.registered = set()
        self.calls = []
    def client(self, _base):
        return self
    def request(self, method, path, **kwargs):
        self.calls.append((method, path))
        return None, {}, 204
    def login(self, account):
        return {"id": account["email"]}
    def get(self, path):
        if path == "/api/workspaces":
            return self.workspaces * (2 if self.fail == "duplicate" else 1)
        if path.endswith("/ai/model"):
            return {"provider": "paid" if self.fail == "provider" else "deterministic"}
        if path.endswith("/members"): return self.members
        if path.endswith("/sources"): return self.sources
        if "/sources/" in path:
            return {**next(value for value in self.sources if value["id"] == path.rsplit("/", 1)[1]), "status": "FAILED" if self.fail == "processing" else "READY"}
        if path.endswith("/analyses"): return self.analyses
        if path.endswith("/executions"): return self.executions
        if "/executions/" in path: return self.executions[0]
        if path.endswith("/documents"): return self.documents
        if path.endswith("/comments"): return self.comments
        if "/comments/" in path: return {"comment": self.comments[0]}
        if "/documents/" in path: return {**self.documents[0], "content": {} if self.fail == "edited" else self.documents[0]["content"]}
        raise AssertionError(path)
    def post(self, path, body=None, expected=None):
        self.calls.append(("POST", path))
        if path == "/api/auth/register":
            if self.fail == "registration": raise ApiError(500, path, "failure")
            if body["email"] in self.registered: raise ApiError(409, path, "conflict")
            self.registered.add(body["email"])
            return {}
        if path == "/api/workspaces":
            value = {"id":"workspace", **body}
            self.workspaces.append(value)
            return value
        if path.endswith("/members"):
            self.members.append(body)
            return body
        if path.endswith("/analyses"):
            value = {"id":"analysis", "plan":None, **body}
            self.analyses.append(value)
            return value
        if path.endswith("/plan"):
            self.analyses[0]["plan"] = {"outputs":[{"name":"wrong" if self.fail == "plan" else "rc-fit-table"}]}
            return self.analyses[0]
        if path.endswith("/execute"):
            digest = hashlib.sha256((fixtures.DESTINATION / "rc-measurements.xlsx").read_bytes()).hexdigest()
            value = {"id":"execution", "status":"FAILED" if self.fail == "execution" else "SUCCEEDED",
                     "failureCode":"SANDBOX_DISABLED", "provenance":{"imageId":None if self.fail == "provenance" else "sha256:runtime",
                      "codeSha256":"code", "inputs":[{"sha256":digest}]}}
            self.executions.append(value)
            return value
        if path.endswith("/ai/questions"):
            grounded = body["question"] == seed.QUESTION
            if self.fail == "grounded" and grounded: grounded = False
            if self.fail == "humidity" and not grounded: grounded = True
            return {"status":"SUPPORTED" if grounded else "INSUFFICIENT_EVIDENCE", "answer":"Nominal tau is 4.7 seconds",
                    "citations":[{"sourceId":"source"}] if grounded else []}
        if path.endswith("/documents"):
            value = {"id":"document", **body}
            self.documents.append(value)
            return value
        if path.endswith("/comments"):
            value = {**body, "replies":[]}
            self.comments.append(value)
            return value
        if path.endswith("/replies"):
            self.comments[0]["replies"].append(body)
            return body
        raise AssertionError(path)
    def upload(self, path, file):
        value = {"id":file.name, "originalFilename":file.name, "activeVersionId":"version", "status":"READY",
                 "contentSha256":"bad" if self.fail == "hash" else hashlib.sha256(file.read_bytes()).hexdigest()}
        self.sources.append(value)
        return value

class SeedTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "accounts.json"
    def run_seed(self, api):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            result = seed.seed("http://synthetic", self.path, 4, api.client)
        return result, output.getvalue()
    def test_two_runs_preserve_workspace_fixtures_execution_and_credentials(self):
        api = FakeRest()
        first, printed = self.run_seed(api)
        second, repeated = self.run_seed(api)
        self.assertEqual(first, second)
        self.assertEqual(len(api.workspaces), 1)
        self.assertEqual(len(api.sources), 4)
        self.assertEqual(len(api.executions), 1)
        self.assertIn("shown once", printed)
        self.assertNotIn("password=", repeated)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(json.loads((self.path.parent/"k6.json").read_text())["users"]), 4)
        self.assertFalse(any("sql" in path.lower() for _, path in api.calls))
    def test_registration_crash_is_recovered_with_saved_password(self):
        api = FakeRest()
        self.run_seed(api)
        state = json.loads(self.path.read_text())
        state["accounts"]["owner"].pop("registered")
        save_private(self.path, state)
        self.run_seed(api)
        self.assertEqual(len(api.workspaces), 1)
    def test_failure_states_never_silently_accept_invalid_demo(self):
        for failure in ("registration","provider","hash","processing","plan","execution","provenance","grounded","humidity","edited"):
            with self.subTest(failure=failure):
                self.path.unlink(missing_ok=True)
                with self.assertRaises((RuntimeError, ApiError)), contextlib.redirect_stdout(io.StringIO()):
                    seed.seed("http://synthetic", self.path, 4, FakeRest(failure).client)
    def test_ambiguous_workspace_is_not_selected(self):
        api=FakeRest()
        self.run_seed(api)
        api.fail="duplicate"
        with self.assertRaisesRegex(RuntimeError, "Ambiguous"): self.run_seed(api)
    def test_fixtures_are_byte_stable_and_workbook_has_realistic_complete_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            first=fixtures.generate(Path(directory))
            second=fixtures.generate(Path(directory))
            self.assertEqual(first,second)
            self.assertEqual(first,{name:hashlib.sha256((fixtures.DESTINATION/name).read_bytes()).hexdigest() for name in fixtures.FILES})
            with zipfile.ZipFile(Path(directory)/"rc-measurements.xlsx") as workbook:
                self.assertIsNone(workbook.testzip())
                sheet=workbook.read("xl/worksheets/sheet1.xml")
                self.assertIn(b"A1:D244",sheet)
            rows=fixtures.measurements()
            self.assertEqual(len(rows),244)
            self.assertEqual(rows[0],("time_s","voltage_v","trial","temperature_c"))
            self.assertEqual({row[2] for row in rows[1:]},{1,2,3})
            self.assertTrue(all(row[1]>0 for row in rows[1:]))
            self.assertIn(b"\\(literal\\)", fixtures.pdf("Title", ["(literal)"]))
    def test_wait_is_bounded_and_private_state_replaces_atomically(self):
        self.assertEqual(wait_for(lambda:{"status":"READY"},lambda item:item["status"]=="READY"),{"status":"READY"})
        with patch("api.time.monotonic",side_effect=[0,0,2]),patch("api.time.sleep") as sleep:
            with self.assertRaises(TimeoutError): wait_for(lambda:0,lambda value:False,timeout=1)
            sleep.assert_called_once()
        save_private(self.path,{"one":1})
        save_private(self.path,{"two":2})
        self.assertEqual(json.loads(self.path.read_text()),{"two":2})
        self.assertIn("REST 409",str(ApiError(409,"/api/synthetic","CONFLICT")))

if __name__ == "__main__":
    unittest.main()

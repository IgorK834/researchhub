import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread
import unittest
from api import Client, ApiError


class PublicApiClientTest(unittest.TestCase):
    def setUp(self):
        self.seen = []
        seen = self.seen
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                if self.path == "/api/auth/csrf":
                    cookie = "after-login" if "JSESSIONID=session" in self.headers.get("Cookie","") else "before-login"
                    self.send_response(204)
                    self.send_header("Set-Cookie","XSRF-TOKEN=" + cookie + "; Path=/")
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"id":"synthetic"}')
            def do_POST(self):
                payload = self.rfile.read(int(self.headers.get("Content-Length",0)))
                seen.append((self.path,self.headers,payload))
                if self.path == "/api/auth/login":
                    if self.headers.get("X-XSRF-TOKEN") != "before-login":
                        self.send_response(403)
                        self.end_headers()
                        self.wfile.write(b'{"code":"CSRF"}')
                        return
                    self.send_response(200)
                    self.send_header("Set-Cookie","JSESSIONID=session; Path=/; HttpOnly")
                    self.end_headers()
                    self.wfile.write(b'{"id":"synthetic"}')
                elif self.path == "/failure":
                    self.send_response(429)
                    self.end_headers()
                    self.wfile.write(b'{"code":"RATE_LIMITED"}')
                elif self.path == "/quota":
                    self.send_response(429)
                    self.end_headers()
                    self.wfile.write(b'{"code":"RATE_LIMIT_EXCEEDED","retryAfterSeconds":12}')
                elif self.path == "/upload":
                    self.send_response(201)
                    self.end_headers()
                    self.wfile.write(b'{"id":"source"}')
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"id":"synthetic"}')
        self.server = ThreadingHTTPServer(("127.0.0.1",0),Handler)
        self.thread=Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.client=Client("http://127.0.0.1:" + str(self.server.server_port))
    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
    def test_login_refreshes_csrf_and_uses_only_server_session_cookies(self):
        self.client.login({"email":"load-001@rc-demo.example.test","password":"generated-only"})
        self.client.post("/mutation",{"synthetic":True})
        self.assertEqual(self.seen[0][1]["X-XSRF-TOKEN"],"before-login")
        self.assertEqual(self.seen[1][1]["X-XSRF-TOKEN"],"after-login")
        self.assertIn("JSESSIONID=session",self.seen[1][1]["Cookie"])
        self.assertNotIn("Authorization",self.seen[1][1])
        self.assertEqual(self.client.get("/read"),{"id":"synthetic"})
    def test_expected_rejections_and_upload_bytes_are_explicit(self):
        with self.assertRaises(ApiError) as failure:
            self.client.post("/failure",{"synthetic":True})
        self.assertEqual(failure.exception.status,429)
        self.assertIn("RATE_LIMITED",str(failure.exception))
        _,_,status=self.client.request("POST","/failure",expected=(429,))
        self.assertEqual(status,429)
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/"fixture.unknown"
            file.write_bytes(b"authored synthetic bytes")
            self.assertEqual(self.client.upload("/upload",file),{"id":"source"})
        headers,payload=self.seen[-1][1:]
        self.assertIn("multipart/form-data; boundary=researchhub-",headers["Content-Type"])
        self.assertIn(b'filename="fixture.unknown"',payload)
        self.assertIn(b"authored synthetic bytes",payload)

    def test_application_quota_exposes_only_the_bounded_retry_window(self):
        with self.assertRaises(ApiError) as failure:
            self.client.post('/quota')
        self.assertEqual('RATE_LIMIT_EXCEEDED', failure.exception.code)
        self.assertEqual(12, failure.exception.retry_after_seconds)
        with self.assertRaises(ApiError) as failure:
            self.client.post('/failure')
        self.assertIsNone(failure.exception.retry_after_seconds)


if __name__ == "__main__":
    unittest.main()

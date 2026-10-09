"""Public REST client used by the synthetic seed and consistency checks. No SQL writes."""
import http.cookiejar
import json
import mimetypes
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request


class ApiError(RuntimeError):
    def __init__(self, status, path, code, retry_after_seconds=None):
        super().__init__(f"REST {status} {path}: {code}")
        self.status = status
        self.code = code
        self.retry_after_seconds = retry_after_seconds


class Client:
    def __init__(self, base_url, ssl_context=None):
        self.base_url = base_url.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        handlers = [urllib.request.HTTPCookieProcessor(self.jar)]
        if ssl_context is not None:
            handlers.append(urllib.request.HTTPSHandler(context=ssl_context))
        self.opener = urllib.request.build_opener(*handlers)

    def request(self, method, path, body=None, expected=(200,), raw=None, content_type=None):
        headers = {}
        if body is not None:
            raw = json.dumps(body).encode()
            content_type = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        if method not in ("GET", "HEAD"):
            token = next((cookie.value for cookie in self.jar if cookie.name == "XSRF-TOKEN"), None)
            if token:
                headers["X-XSRF-TOKEN"] = urllib.parse.unquote(token)
        request = urllib.request.Request(self.base_url + path, data=raw, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=120)
        except urllib.error.HTTPError as response_error:
            response = response_error
        with response:
            data = response.read()
            payload = json.loads(data) if data else None
            if response.status not in expected:
                retry_after = payload.get('retryAfterSeconds') if isinstance(payload, dict) else None
                if type(retry_after) is not int or not 1 <= retry_after <= 60:
                    retry_after = None
                raise ApiError(response.status, path, payload.get("code", payload.get("title", "Unexpected response")) if isinstance(payload, dict) else "Unexpected response", retry_after)
            return payload, dict(response.headers), response.status

    def get(self, path):
        return self.request("GET", path)[0]

    def post(self, path, body=None, expected=(200, 201, 202, 204)):
        return self.request("POST", path, body, expected)[0]

    def login(self, account):
        self.request("GET", "/api/auth/csrf", expected=(204,))
        result = self.post("/api/auth/login", {key: account[key] for key in ("email", "password")})
        # Login rotates the credential and clears the old CSRF token.
        self.request("GET", "/api/auth/csrf", expected=(204,))
        return result

    def upload(self, path, file):
        boundary = "researchhub-" + secrets.token_hex(16)
        media_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        data = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file.name}"\r\nContent-Type: {media_type}\r\n\r\n'.encode()
                + file.read_bytes() + f"\r\n--{boundary}--\r\n".encode())
        return self.request("POST", path, expected=(201,), raw=data, content_type="multipart/form-data; boundary=" + boundary)[0]


def wait_for(read, complete, timeout=180, interval=0.5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = read()
        if complete(value):
            return value
        time.sleep(interval)
    raise TimeoutError("REST operation did not complete within its bounded deadline")


def save_private(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)

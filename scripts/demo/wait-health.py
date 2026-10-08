#!/usr/bin/env python3
"""Wait for a public readiness endpoint, without credentials or an unbounded retry."""
import sys
import time
import urllib.error
import urllib.request

deadline = time.monotonic() + 180
while time.monotonic() < deadline:
    try:
        with urllib.request.urlopen(sys.argv[1], timeout=3) as response:
            if response.status == 200:
                break
    except (urllib.error.URLError, TimeoutError):
        pass
    time.sleep(1)
else:
    raise SystemExit("Public readiness did not become healthy within 180 seconds")

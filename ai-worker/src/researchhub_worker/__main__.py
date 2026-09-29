"""Run the local worker with ``python -m researchhub_worker``."""

from __future__ import annotations

import logging
import os

from .server import create_server


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    host = os.getenv("AI_WORKER_HOST", "0.0.0.0")
    port = int(os.getenv("AI_WORKER_PORT", "8090"))
    server = create_server(host, port)
    logging.getLogger(__name__).info("AI worker listening on %s:%s", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

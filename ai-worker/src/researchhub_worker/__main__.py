"""Run the dedicated worker through its installed ``researchhub-worker`` command."""

from __future__ import annotations

import logging
import os

import uvicorn

from .server import create_app
from .observability import configure_logging


def main() -> None:
    log_level = os.getenv("LOG_LEVEL", "INFO").lower()
    log_config = configure_logging(log_level)
    host = os.getenv("AI_WORKER_HOST", "0.0.0.0")
    port = int(os.getenv("AI_WORKER_PORT", "8090"))
    logging.getLogger(__name__).info("AI worker listening on %s:%s", host, port)
    uvicorn.run(create_app(), host=host, port=port, log_level=log_level, log_config=log_config, access_log=False)


if __name__ == "__main__":
    main()

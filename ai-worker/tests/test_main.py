from unittest.mock import patch

from fastapi import FastAPI

from researchhub_worker.__main__ import main


def test_main_starts_uvicorn_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("AI_WORKER_HOST", "127.0.0.1")
    monkeypatch.setenv("AI_WORKER_PORT", "9010")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    monkeypatch.setenv("AI_WORKER_SERVICE_TOKEN", "unit-test-service-token-at-least-32-characters")

    with patch("researchhub_worker.__main__.uvicorn.run") as run:
        main()

    app = run.call_args.args[0]
    assert isinstance(app, FastAPI)
    assert run.call_args.kwargs == {
        "host": "127.0.0.1",
        "port": 9010,
        "log_level": "warning",
        "log_config": run.call_args.kwargs["log_config"],
        "access_log": False,
    }

FROM python:3.13.3-slim-bookworm@sha256:56a11364ffe0fee3bd60af6d6d5209eba8a99c2c16dc4c7c5861dc06261503cc AS build

# Install the same pinned tool from PyPI; no second image registry is needed for the build.
RUN python -m pip install --no-cache-dir uv==0.12.20

WORKDIR /app
ENV PATH="/app/.venv/bin:${PATH}" \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN uv sync --frozen --no-dev --no-editable

FROM python:3.13.3-slim-bookworm@sha256:56a11364ffe0fee3bd60af6d6d5209eba8a99c2c16dc4c7c5861dc06261503cc AS runtime
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:${PATH} PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 AI_WORKER_HOST=0.0.0.0 AI_WORKER_PORT=8090
USER 10001:10001

EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=2).close()"]
CMD ["researchhub-worker"]

FROM ghcr.io/astral-sh/uv:0.12.20 AS uv

FROM python:3.13.3-slim

COPY --from=uv /uv /uvx /bin/

WORKDIR /app
ENV PATH="/app/.venv/bin:${PATH}" \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN uv sync --frozen --no-dev --no-editable

RUN useradd --create-home --uid 10001 worker
USER worker

EXPOSE 8090
CMD ["researchhub-worker"]

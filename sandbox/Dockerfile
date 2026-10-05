FROM python:3.13.3-slim-bookworm@sha256:56a11364ffe0fee3bd60af6d6d5209eba8a99c2c16dc4c7c5861dc06261503cc

LABEL org.opencontainers.image.title="ResearchHub isolated computation runtime" \
      org.opencontainers.image.version="1.0.0"
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1
COPY requirements.lock /opt/researchhub/requirements.lock
RUN python -m pip install --no-cache-dir --only-binary=:all: -r /opt/researchhub/requirements.lock \
    && python -m pip uninstall -y pip \
    && mkdir -p /execution /inputs /outputs \
    && chmod 0555 /execution /inputs /outputs
COPY runtime/ /opt/researchhub/
RUN chmod -R a-w /opt/researchhub
WORKDIR /execution
USER 65532:65532
ENTRYPOINT ["python", "-I", "/opt/researchhub/run.py"]

FROM node:26.9.0-bookworm-slim@sha256:582460f614631b59b824ac6020533b9bf339c7fdf3a6d7db31abb6b4065f0212 AS build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/src/ src/
COPY frontend/public/ public/
COPY frontend/security/ security/
COPY frontend/docker/ docker/
COPY contracts/ /build/contracts/
COPY frontend/tsconfig.json frontend/webpack.config.cjs frontend/babel.config.cjs frontend/THIRD_PARTY_NOTICES.md ./
# These arguments are PUBLIC browser settings; never pass credentials.
ARG RESEARCHHUB_API_BASE_URL=""
ARG RESEARCHHUB_CSP_CONNECT_ORIGINS=""
ARG RESEARCHHUB_COLLABORATION_ENABLED="false"
ARG RESEARCHHUB_DEPLOYMENT_ENV="cloud"
RUN npm run build && node docker/security-headers.cjs

FROM caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d AS runtime
RUN setcap -r /usr/bin/caddy
COPY --from=build /build/frontend/dist/ /srv/
COPY --from=build /build/frontend/docker/security-headers.caddy /etc/caddy/security-headers.caddy
COPY frontend/docker/Caddyfile /etc/caddy/Caddyfile
ENV XDG_CONFIG_HOME=/tmp/config XDG_DATA_HOME=/tmp/data
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

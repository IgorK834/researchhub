FROM eclipse-temurin:25.0.2_10-jdk-noble@sha256:b866059783e3dd2dd183937b713e77d0fd94d87ce7bdd4ed4a77d79e97a276cd AS build
WORKDIR /build
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
ARG BUILD_COMMIT
RUN --mount=type=cache,target=/root/.m2 ./mvnw --batch-mode --no-transfer-progress dependency:go-offline
COPY src/ src/
COPY docker/HealthProbe.java /probe/HealthProbe.java
RUN --mount=type=cache,target=/root/.m2 printf '%s' "${BUILD_COMMIT}" | grep -Eq '^[a-f0-9]{40}$' && ./mvnw --batch-mode --no-transfer-progress -Dbuild.commit="${BUILD_COMMIT}" -DskipTests package && javac -d /probe /probe/HealthProbe.java

ADD --checksum=sha256:4ab7a442bf9defc7475d026c6b49042793ebb010c391a1db91ae07da0c04d848 https://github.com/microsoft/ApplicationInsights-Java/releases/download/3.7.9/applicationinsights-agent-3.7.9.jar /opt/observability/applicationinsights-agent.jar

FROM eclipse-temurin:25.0.2_10-jre-noble@sha256:a051234f864d7ab78bf0188c3c540ac06c711a3b566f00f246be37073cc99dce AS runtime
ARG BUILD_COMMIT
LABEL org.opencontainers.image.revision="${BUILD_COMMIT}"
WORKDIR /app
COPY --from=build --chown=10001:10001 /build/target/backend-0.0.1-SNAPSHOT.jar /app/backend.jar
COPY --from=build /probe/HealthProbe.class /opt/health/HealthProbe.class
COPY --from=build /opt/observability/applicationinsights-agent.jar /opt/observability/applicationinsights-agent.jar
COPY observability/applicationinsights.json /opt/observability/applicationinsights.json
ENV SERVER_PORT=8080 SPRING_MAIN_BANNER_MODE=off
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=6 CMD ["java", "-cp", "/opt/health", "HealthProbe"]
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/backend.jar"]

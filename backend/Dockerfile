FROM eclipse-temurin:25.0.2_10-jdk-noble@sha256:b866059783e3dd2dd183937b713e77d0fd94d87ce7bdd4ed4a77d79e97a276cd AS build
WORKDIR /build
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN --mount=type=cache,target=/root/.m2 ./mvnw --batch-mode --no-transfer-progress dependency:go-offline
COPY src/ src/
COPY docker/HealthProbe.java /probe/HealthProbe.java
RUN --mount=type=cache,target=/root/.m2 ./mvnw --batch-mode --no-transfer-progress -DskipTests package && javac -d /probe /probe/HealthProbe.java

FROM eclipse-temurin:25.0.2_10-jre-noble@sha256:a051234f864d7ab78bf0188c3c540ac06c711a3b566f00f246be37073cc99dce AS runtime
WORKDIR /app
COPY --from=build --chown=10001:10001 /build/target/backend-0.0.1-SNAPSHOT.jar /app/backend.jar
COPY --from=build /probe/HealthProbe.class /opt/health/HealthProbe.class
ENV SERVER_PORT=8080 SPRING_MAIN_BANNER_MODE=off
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=6 CMD ["java", "-cp", "/opt/health", "HealthProbe"]
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/backend.jar"]

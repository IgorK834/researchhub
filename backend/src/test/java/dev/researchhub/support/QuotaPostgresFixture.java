package dev.researchhub.support;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Separate pools against the same real PostgreSQL; schema always comes from production Flyway migrations. */
public final class QuotaPostgresFixture {
    private QuotaPostgresFixture() {}

    public static PostgreSQLContainer database() {
        return new PostgreSQLContainer(DockerImageName.parse("pgvector/pgvector:0.8.2-pg17-bookworm")
                .asCompatibleSubstituteFor("postgres"));
    }

    public static HikariDataSource pool(PostgreSQLContainer database, String name) {
        var config = new HikariConfig();
        config.setJdbcUrl(database.getJdbcUrl());
        config.setUsername(database.getUsername());
        config.setPassword(database.getPassword());
        config.setPoolName(name);
        config.setMaximumPoolSize(8);
        config.setConnectionTimeout(10_000);
        return new HikariDataSource(config);
    }

    public static void migrate(HikariDataSource pool) {
        Flyway.configure().dataSource(pool).locations("classpath:db/migration").load().migrate();
    }
}

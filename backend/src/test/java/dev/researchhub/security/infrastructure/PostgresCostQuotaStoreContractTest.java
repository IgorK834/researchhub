package dev.researchhub.security.infrastructure;

import com.zaxxer.hikari.HikariDataSource;
import dev.researchhub.security.application.*;
import dev.researchhub.support.QuotaPostgresFixture;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.*;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
class PostgresCostQuotaStoreContractTest extends CostQuotaStoreContract {
    @Container static final PostgreSQLContainer DATABASE = QuotaPostgresFixture.database();
    static HikariDataSource pool;
    static JdbcTemplate jdbc;

    @BeforeAll static void database() {
        pool = QuotaPostgresFixture.pool(DATABASE, "quota-contract");
        QuotaPostgresFixture.migrate(pool);
        jdbc = new JdbcTemplate(pool);
    }
    @AfterAll static void close() { if (pool != null) pool.close(); }

    @Override protected CostQuotaStore createStore(Clock clock, SimpleMeterRegistry metrics) {
        jdbc.execute("TRUNCATE cost_quota_bucket");
        return new PostgresCostQuotaStore(new NamedParameterJdbcTemplate(pool),
                new DataSourceTransactionManager(pool), clock, metrics, Duration.ofDays(7), Duration.ofMinutes(1), 3);
    }

    @Test void rejectedAdmissionLeavesBothCountersAndTimestampsUnchanged() {
        var policy = policy(3, 1);
        UUID full = UUID.randomUUID();
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy);
        store.admit(UUID.randomUUID(), full, CostCategory.LLM, policy);
        var before = jdbc.queryForList("SELECT * FROM cost_quota_bucket ORDER BY scope_type, scope_id");
        clock.now = clock.now.plusSeconds(5);
        rejected(USER, full, CostCategory.LLM, policy, 55);
        rejected(UUID.randomUUID(), full, CostCategory.LLM, policy, 55);
        assertEquals(before, jdbc.queryForList("SELECT * FROM cost_quota_bucket ORDER BY scope_type, scope_id"));
    }

    @Test void cleanupDeletesOnlyOlderBucketsAndKeepsTheRetentionBoundaryAndCurrentWindow() {
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy(1, 1));
        clock.now = clock.now.plus(Duration.ofDays(7));
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy(1, 1));
        assertEquals(0, ((PostgresCostQuotaStore) store).removeExpiredBuckets());
        clock.now = clock.now.plusSeconds(1);
        assertEquals(2, ((PostgresCostQuotaStore) store).removeExpiredBuckets());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cost_quota_bucket", Integer.class));
        rejected(USER, WORKSPACE, CostCategory.LLM, policy(1, 1), 59);
    }

    @Test void admissionCommitsIndependentlyOfLaterBusinessRollback() {
        var business = new TransactionTemplate(new DataSourceTransactionManager(pool));
        business.executeWithoutResult(status -> {
            store.admit(USER, WORKSPACE, CostCategory.LLM, policy(1, 1));
            status.setRollbackOnly();
        });
        rejected(USER, WORKSPACE, CostCategory.LLM, policy(1, 1), 60);
        assertEquals(2, jdbc.queryForObject("SELECT sum(request_count) FROM cost_quota_bucket", Integer.class));
    }

    @Test void runtimePolicyCannotOutliveRetention() {
        assertThrows(IllegalArgumentException.class, () -> new PostgresCostQuotaStore(
                new NamedParameterJdbcTemplate(pool), new DataSourceTransactionManager(pool), clock, metrics,
                Duration.ofSeconds(1), Duration.ofMinutes(1), 3));
        for (int attempts : new int[]{0, 11}) assertThrows(IllegalArgumentException.class,
                () -> new PostgresCostQuotaStore(new NamedParameterJdbcTemplate(pool), new DataSourceTransactionManager(pool),
                        clock, metrics, Duration.ofDays(7), Duration.ofMinutes(1), attempts));
        var shortRetention = new PostgresCostQuotaStore(new NamedParameterJdbcTemplate(pool),
                new DataSourceTransactionManager(pool), clock, metrics, Duration.ofSeconds(1), Duration.ofSeconds(1), 3);
        assertThrows(IllegalArgumentException.class,
                () -> shortRetention.admit(USER, WORKSPACE, CostCategory.LLM, policy(1, 1)));
    }

    @ParameterizedTest @CsvSource({"40001,false", "40P01,false", "40001,true"})
    void postgresConflictsRollBackTheUserAndRetryTheEntireAdmission(String state, boolean atCommit) {
        jdbc.execute("CREATE SEQUENCE quota_retry_probe");
        jdbc.execute("""
                CREATE FUNCTION quota_conflict_probe() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.scope_type = 'WORKSPACE' AND nextval('quota_retry_probe') = 1 THEN
                        RAISE EXCEPTION 'test transaction conflict' USING ERRCODE = '%s';
                    END IF;
                    RETURN NEW;
                END $$
                """.formatted(state));
        jdbc.execute(atCommit
                ? "CREATE CONSTRAINT TRIGGER quota_conflict AFTER INSERT ON cost_quota_bucket DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION quota_conflict_probe()"
                : "CREATE TRIGGER quota_conflict BEFORE INSERT ON cost_quota_bucket FOR EACH ROW EXECUTE FUNCTION quota_conflict_probe()");
        try {
            store.admit(USER, WORKSPACE, CostCategory.LLM, policy(1, 1));
            assertEquals(2, jdbc.queryForObject("SELECT last_value FROM quota_retry_probe", Integer.class));
            assertEquals(2, jdbc.queryForObject("SELECT sum(request_count) FROM cost_quota_bucket", Integer.class));
            assertEquals(0, metrics.get("researchhub.security.quotas.rejections").tag("category", "LLM").counter().count());
        } finally {
            jdbc.execute("DROP TRIGGER quota_conflict ON cost_quota_bucket");
            jdbc.execute("DROP FUNCTION quota_conflict_probe()");
            jdbc.execute("DROP SEQUENCE quota_retry_probe");
        }
    }

    @org.springframework.context.annotation.Configuration(proxyBeanMethods = false)
    @org.springframework.scheduling.annotation.EnableScheduling
    static class SchedulingProbe {}

    @Test void scheduledCleanupActuallyRemovesExpiredHistory() throws Exception {
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy(1, 1));
        clock.now = clock.now.plus(Duration.ofDays(7)).plusSeconds(1);
        try (var context = new org.springframework.context.annotation.AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource(
                    "cleanup-test", java.util.Map.of("researchhub.security.quotas.cleanup-cron", "*/1 * * * * *")));
            context.register(SchedulingProbe.class);
            context.registerBean(PostgresCostQuotaStore.class, () -> (PostgresCostQuotaStore) store);
            context.refresh();
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
            while (jdbc.queryForObject("SELECT count(*) FROM cost_quota_bucket", Integer.class) != 0
                    && System.nanoTime() < deadline) Thread.sleep(50);
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cost_quota_bucket", Integer.class));
        }
    }
}

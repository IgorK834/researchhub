package dev.researchhub.security.infrastructure;

import com.zaxxer.hikari.HikariDataSource;
import dev.researchhub.security.application.*;
import dev.researchhub.support.QuotaPostgresFixture;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import static org.junit.jupiter.api.Assertions.*;

/** Twenty consecutive repetitions of each contention scenario, with two independent replica pools. */
@Testcontainers
@Timeout(value = 60)
class PostgresCostQuotaConcurrencyTest {
    @Container static final PostgreSQLContainer DATABASE = QuotaPostgresFixture.database();
    static HikariDataSource poolA, poolB;
    static JdbcTemplate jdbc;
    static PostgresCostQuotaStore backendA, backendB;
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-07T12:00:30Z"), ZoneOffset.UTC);

    @BeforeAll static void start() {
        poolA = QuotaPostgresFixture.pool(DATABASE, "quota-backend-A");
        poolB = QuotaPostgresFixture.pool(DATABASE, "quota-backend-B");
        QuotaPostgresFixture.migrate(poolA);
        jdbc = new JdbcTemplate(poolA);
        backendA = store(poolA); backendB = store(poolB);
    }
    @AfterAll static void stop() {
        if (poolA != null) poolA.close();
        if (poolB != null) poolB.close();
    }
    @BeforeEach void reset() { jdbc.execute("TRUNCATE cost_quota_bucket"); }

    static PostgresCostQuotaStore store(HikariDataSource pool) {
        return new PostgresCostQuotaStore(new NamedParameterJdbcTemplate(pool), new DataSourceTransactionManager(pool),
                CLOCK, new SimpleMeterRegistry(), Duration.ofDays(7), Duration.ofMinutes(1), 3);
    }

    @RepeatedTest(20) void samePairNeverOversubscribesEitherScope() throws Exception {
        for (QuotaPolicy policy : List.of(policy(73, 1000), policy(1000, 73))) {
            jdbc.execute("TRUNCATE cost_quota_bucket");
            UUID user = UUID.randomUUID(), workspace = UUID.randomUUID();
            AtomicInteger succeeded = new AtomicInteger(), rejected = new AtomicInteger();
            contend((replica, thread, call) -> {
                try { replica.admit(user, workspace, CostCategory.LLM, policy); succeeded.incrementAndGet(); }
                catch (RateLimitExceededException expected) { rejected.incrementAndGet(); }
            });
            assertEquals(73, succeeded.get());
            assertEquals(1600 - 73, rejected.get());
            assertEquals(73, count("USER", user));
            assertEquals(73, count("WORKSPACE", workspace));
            assertEquals(146, jdbc.queryForObject("SELECT sum(request_count) FROM cost_quota_bucket", Integer.class));
        }
    }

    @RepeatedTest(20) void sharedWorkspaceRefusalsDoNotChargeAnyUser() throws Exception {
        UUID workspace = UUID.randomUUID();
        List<UUID> users = java.util.stream.IntStream.range(0, 16).mapToObj(i -> UUID.randomUUID()).toList();
        List<AtomicInteger> admitted = users.stream().map(id -> new AtomicInteger()).toList();
        AtomicInteger rejected = new AtomicInteger();
        var policy = policy(100, 73);
        contend((replica, thread, call) -> {
            try { replica.admit(users.get(thread), workspace, CostCategory.LLM, policy); admitted.get(thread).incrementAndGet(); }
            catch (RateLimitExceededException expected) { rejected.incrementAndGet(); }
        });
        assertEquals(73, admitted.stream().mapToInt(AtomicInteger::get).sum());
        assertEquals(1600 - 73, rejected.get());
        assertEquals(73, count("WORKSPACE", workspace));
        for (int i = 0; i < users.size(); i++) {
            assertEquals(admitted.get(i).get(), count("USER", users.get(i)), "workspace refusals must roll back each user");
            // Each user can still spend exactly its remaining global budget elsewhere.
            UUID available = UUID.randomUUID();
            for (int call = admitted.get(i).get(); call < 100; call++)
                backendB.admit(users.get(i), available, CostCategory.LLM, policy(100, 1000));
            assertEquals(100, count("USER", users.get(i)));
            UUID user = users.get(i);
            assertThrows(RateLimitExceededException.class,
                    () -> backendA.admit(user, available, CostCategory.LLM, policy(100, 1000)));
        }
    }

    @RepeatedTest(20) void swappedCallerIdsCannotReverseTheScopeLockOrder() throws Exception {
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        AtomicInteger admitted = new AtomicInteger();
        var policy = policy(73, 73);
        contend((replica, thread, call) -> {
            UUID user = thread % 2 == 0 ? first : second;
            UUID workspace = thread % 2 == 0 ? second : first;
            try { replica.admit(user, workspace, CostCategory.LLM, policy); admitted.incrementAndGet(); }
            catch (RateLimitExceededException expected) { }
        });
        assertEquals(146, admitted.get());
        for (String scope : List.of("USER", "WORKSPACE")) {
            assertEquals(73, count(scope, first));
            assertEquals(73, count(scope, second));
        }
    }

    private static int count(String scope, UUID id) {
        return jdbc.queryForObject("SELECT coalesce(sum(request_count), 0) FROM cost_quota_bucket WHERE scope_type=? AND scope_id=?",
                Integer.class, scope, id);
    }

    private static QuotaPolicy policy(int user, int workspace) {
        return new QuotaPolicy(user, workspace, Duration.ofMinutes(1));
    }

    @FunctionalInterface private interface Admission { void run(PostgresCostQuotaStore store, int thread, int call); }

    private static void contend(Admission admission) throws Exception {
        var executor = Executors.newFixedThreadPool(16);
        var start = new CountDownLatch(1);
        try {
            List<Future<?>> tasks = new ArrayList<>();
            for (int thread = 0; thread < 16; thread++) {
                int index = thread;
                tasks.add(executor.submit(() -> {
                    if (!start.await(5, TimeUnit.SECONDS)) throw new AssertionError("Contenders did not start");
                    var replica = index < 8 ? backendA : backendB;
                    for (int call = 0; call < 100; call++) admission.run(replica, index, call);
                    return null;
                }));
            }
            start.countDown();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
            for (var task : tasks) task.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
        } finally {
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS), "A lock wait outlived the timeout guard");
        }
    }
}

package dev.researchhub.support;

import com.zaxxer.hikari.HikariDataSource;
import dev.researchhub.workspace.UserRowFixture;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.*;

/** Three independent bean graphs, connection pools and transaction managers; one real migrated database. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public abstract class DispatcherRaceDatabase {
    protected final PostgreSQLContainer database = new PostgreSQLContainer(
            DockerImageName.parse("pgvector/pgvector:0.8.2-pg17-bookworm").asCompatibleSubstituteFor("postgres"));
    protected final List<AnnotationConfigApplicationContext> contexts = new ArrayList<>();
    protected final ObjectMapper json = new ObjectMapper();
    protected final ConcurrentMap<UUID, Integer> calls = new ConcurrentHashMap<>();
    protected final MutableClock clock = new MutableClock();
    protected JdbcTemplate jdbc;
    protected UUID user, workspace, document;

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    public static class Transactions {}

    @BeforeAll void startDatabase() {
        database.start();
        Flyway.configure().dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword()).load().migrate();
        for (int i = 0; i < 3; i++) contexts.add(newContext());
        jdbc = contexts.getFirst().getBean(JdbcTemplate.class);
    }
    protected abstract void registerDispatcher(AnnotationConfigApplicationContext context);

    protected AnnotationConfigApplicationContext newContext() {
        var context = new AnnotationConfigApplicationContext();
        context.register(Transactions.class);
        context.registerBean(HikariDataSource.class, () -> {
            var pool = new HikariDataSource();
            pool.setJdbcUrl(database.getJdbcUrl()); pool.setUsername(database.getUsername()); pool.setPassword(database.getPassword());
            pool.setMaximumPoolSize(4); pool.setMinimumIdle(1); return pool;
        });
        context.registerBean(JdbcTemplate.class, () -> new JdbcTemplate(context.getBean(HikariDataSource.class)));
        context.registerBean(PlatformTransactionManager.class, () -> new JdbcTransactionManager(context.getBean(HikariDataSource.class)));
        context.registerBean(ObjectMapper.class, () -> json);
        context.registerBean(Clock.class, () -> clock);
        context.registerBean(dev.researchhub.shared.observability.WorkMetrics.class, () -> new dev.researchhub.shared.observability.WorkMetrics(new io.micrometer.core.instrument.simple.SimpleMeterRegistry()));
        registerDispatcher(context);
        context.refresh();
        return context;
    }
    @BeforeEach void fixtures() {
        jdbc.execute("TRUNCATE users, workspaces CASCADE"); calls.clear(); clock.now = Instant.parse("2026-10-08T12:00:00Z");
        user = UserRowFixture.insertUser(jdbc, "race@example.test", "Race test"); workspace = UUID.randomUUID(); document = UUID.randomUUID();
        jdbc.update("INSERT INTO workspaces(id,name,created_by,created_at,updated_at) VALUES (?,'Race',?,now(),now())", workspace, user);
        jdbc.update("INSERT INTO documents(id,workspace_id,title,content_format,content,revision,created_by,created_at,updated_at) VALUES (?,?,'Race','PROSEMIRROR_JSON','{}',1,?,now(),now())", document, workspace, user);
    }
    @AfterAll void stop() {
        contexts.forEach(AnnotationConfigApplicationContext::close); database.close();
    }
    protected void record(UUID id) { calls.merge(id, 1, Integer::sum); }
    protected void race(Consumer<AnnotationConfigApplicationContext> dispatch) throws Exception {
        var barrier = new CyclicBarrier(3);
        try (var executor = Executors.newFixedThreadPool(3)) {
            var futures = contexts.stream().map(context -> executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                for (int i = 0; i < 210; i++) dispatch.accept(context);
                return null;
            })).toList();
            for (var future : futures) future.get(45, TimeUnit.SECONDS);
        }
    }
    protected void assertExactlyOnce(Set<UUID> expected, String table) {
        assertEquals(expected, calls.keySet());
        assertTrue(calls.values().stream().allMatch(count -> count == 1), calls.toString());
        assertEquals(200, jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE status='SUCCEEDED' AND finished_at IS NOT NULL", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE status IN ('PENDING','QUEUED','RUNNING')", Integer.class));
    }
    public static class MutableClock extends Clock {
        public volatile Instant now = Instant.parse("2026-10-08T12:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
}

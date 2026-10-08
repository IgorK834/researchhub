package dev.researchhub.security.infrastructure;

import dev.researchhub.security.application.*;
import io.micrometer.core.instrument.MeterRegistry;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Shared admission; the two conditional increments commit together or both roll back. */
public final class PostgresCostQuotaStore implements CostQuotaStore {
    private static final String CONSUME = """
            INSERT INTO cost_quota_bucket (scope_type, scope_id, category, window_start, request_count, updated_at)
            VALUES (:scope, :id, :category, :window, 1, :now)
            ON CONFLICT (scope_type, scope_id, category, window_start)
            DO UPDATE SET request_count = cost_quota_bucket.request_count + 1, updated_at = EXCLUDED.updated_at
            WHERE cost_quota_bucket.request_count < :limit
            RETURNING request_count
            """;
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final Clock clock;
    private final Duration retention;
    private final int maxAttempts;
    private final CostQuotaMetrics metrics;

    public PostgresCostQuotaStore(NamedParameterJdbcTemplate jdbc, PlatformTransactionManager manager,
            Clock clock, MeterRegistry registry, Duration retention, Duration window, int maxAttempts) {
        if (retention == null || window == null || retention.compareTo(window) < 0 || window.isNegative()
                || window.isZero() || maxAttempts < 1 || maxAttempts > 10) {
            throw new IllegalArgumentException("Quota retention must cover the window; retry attempts must be 1–10");
        }
        this.jdbc = Objects.requireNonNull(jdbc);
        this.clock = Objects.requireNonNull(clock);
        this.retention = retention;
        this.maxAttempts = maxAttempts;
        this.metrics = new CostQuotaMetrics(registry);
        this.transaction = new TransactionTemplate(manager);
        // Admission remains charged if a later business transaction fails, exactly as in memory.
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    @Override
    public void admit(UUID userId, UUID workspaceId, CostCategory category, QuotaPolicy policy) {
        if (policy.window().compareTo(retention) > 0) {
            throw new IllegalArgumentException("Quota retention must cover the admission window");
        }
        for (int attempt = 1; ; attempt++) {
            Instant now = clock.instant();
            CostQuotaWindow window = CostQuotaWindow.at(now, policy.window());
            try {
                transaction.executeWithoutResult(status -> {
                    // Scope order is invariant, even if callers swap the UUIDs.
                    consume("USER", userId, category, policy.userRequests(), window, now);
                    consume("WORKSPACE", workspaceId, category, policy.workspaceRequests(), window, now);
                });
                return;
            } catch (RateLimitExceededException rejected) {
                metrics.rejected(category);
                throw rejected;
            } catch (RuntimeException failure) {
                // Transaction managers can wrap commit-time SQLSTATEs in TransactionSystemException.
                if (attempt >= maxAttempts || !retryable(failure)) throw failure;
            }
        }
    }

    private void consume(String scope, UUID id, CostCategory category, int limit,
            CostQuotaWindow window, Instant now) {
        var parameters = new MapSqlParameterSource().addValue("scope", scope).addValue("id", id)
                .addValue("category", category.name()).addValue("limit", limit)
                .addValue("window", Timestamp.from(window.start())).addValue("now", Timestamp.from(now));
        if (jdbc.query(CONSUME, parameters, (rs, row) -> rs.getInt(1)).isEmpty()) {
            throw new RateLimitExceededException(category, window.retryAfterSeconds(now));
        }
    }

    private static boolean retryable(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql
                    && ("40001".equals(sql.getSQLState()) || "40P01".equals(sql.getSQLState()))) return true;
        }
        return false;
    }

    /** Only expired history is deleted; validation prevents retention from deleting a live window. */
    @Scheduled(cron = "${researchhub.security.quotas.cleanup-cron:0 0 * * * *}")
    public int removeExpiredBuckets() {
        return jdbc.update("DELETE FROM cost_quota_bucket WHERE window_start < :cutoff",
                new MapSqlParameterSource("cutoff", Timestamp.from(clock.instant().minus(retention))));
    }
}

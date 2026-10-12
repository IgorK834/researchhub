package dev.researchhub.security.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.util.Map;

/** Shared PostgreSQL budgets, charged independently even when the operation fails. */
@Service
public class SecurityOperationLimiter {
    public enum Operation { INVITE, PASSWORD, SESSIONS, RESET_REQUEST, RESET, VERIFY_REQUEST, VERIFY, AUDIT_EXPORT, ACCOUNT_EXPORT, ACCOUNT_ERASURE }
    private final JdbcTemplate jdbc;
    private final Clock clock;
    public SecurityOperationLimiter(JdbcTemplate jdbc, Clock clock) { this.jdbc=jdbc; this.clock=clock; }
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public void admit(String subject, Operation operation) {
        int limit = operation == Operation.SESSIONS ? 60 : 10;
        long now = clock.instant().getEpochSecond(), start = now / 3600 * 3600;
        var count = jdbc.query("""
            INSERT INTO security_operation_bucket(subject_hash, operation, window_start, request_count) VALUES (?, ?, ?, 1)
            ON CONFLICT (subject_hash, operation) DO UPDATE SET
              window_start=EXCLUDED.window_start,
              request_count=CASE WHEN security_operation_bucket.window_start=EXCLUDED.window_start
                THEN security_operation_bucket.request_count+1 ELSE 1 END
            WHERE security_operation_bucket.window_start<>EXCLUDED.window_start OR security_operation_bucket.request_count<?
            RETURNING request_count
            """, (rs,row) -> rs.getInt(1), SecureTokens.hash(subject), operation.name(), start, limit);
        if (count.isEmpty()) throw new ApiException(ApiErrorCode.RATE_LIMIT_EXCEEDED,
            "The request limit for this operation has been reached", Map.of("retryAfterSeconds", start+3600-now)) {};
    }
}

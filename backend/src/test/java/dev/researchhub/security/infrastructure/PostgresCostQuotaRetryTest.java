package dev.researchhub.security.infrastructure;

import dev.researchhub.security.application.*;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.*;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PostgresCostQuotaRetryTest {
    private final NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
    private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    private final SimpleMeterRegistry metrics = new SimpleMeterRegistry();
    private final QuotaPolicy policy = new QuotaPolicy(1, 1, Duration.ofMinutes(1));

    @SuppressWarnings("unchecked")
    @ParameterizedTest @ValueSource(strings = {"40001", "40P01"})
    void retriesTheWholeTransactionAfterWorkspaceConflict(String sqlState) {
        when(manager.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        when(jdbc.query(anyString(), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of(1)).thenThrow(failure(sqlState)).thenReturn(List.of(1)).thenReturn(List.of(1));
        store().admit(UUID.randomUUID(), UUID.randomUUID(), CostCategory.LLM, policy);
        verify(manager, times(2)).getTransaction(any());
        verify(manager).rollback(any()); verify(manager).commit(any());
        assertEquals(0, metrics.get("researchhub.security.quotas.rejections").tag("category", "LLM").counter().count());
    }

    @SuppressWarnings("unchecked")
    @Test void retriesAreBoundedAndNonTransientErrorsAreNotRetried() {
        when(manager.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        when(jdbc.query(anyString(), any(SqlParameterSource.class), any(RowMapper.class))).thenThrow(failure("40P01"));
        assertThrows(DataAccessException.class,
                () -> store().admit(UUID.randomUUID(), UUID.randomUUID(), CostCategory.LLM, policy));
        verify(manager, times(3)).rollback(any());
        clearInvocations(manager);
        when(jdbc.query(anyString(), any(SqlParameterSource.class), any(RowMapper.class))).thenThrow(failure("08006"));
        assertThrows(DataAccessException.class,
                () -> store().admit(UUID.randomUUID(), UUID.randomUUID(), CostCategory.LLM, policy));
        verify(manager).getTransaction(any()); verify(manager).rollback(any());
    }

    @SuppressWarnings("unchecked")
    @Test void aQuotaDenialAfterRetryIsCountedOnce() {
        when(manager.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        when(jdbc.query(anyString(), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenThrow(failure("40001")).thenReturn(List.of(1)).thenReturn(List.of());
        assertThrows(RateLimitExceededException.class,
                () -> store().admit(UUID.randomUUID(), UUID.randomUUID(), CostCategory.LLM, policy));
        verify(manager, times(2)).rollback(any()); verify(manager, never()).commit(any());
        assertEquals(1, metrics.get("researchhub.security.quotas.rejections").tag("category", "LLM").counter().count());
    }

    private PostgresCostQuotaStore store() {
        return new PostgresCostQuotaStore(jdbc, manager,
                Clock.fixed(Instant.parse("2026-10-07T12:00:00Z"), ZoneOffset.UTC), metrics,
                Duration.ofDays(7), Duration.ofMinutes(1), 3);
    }
    private static DataAccessException failure(String sqlState) {
        return new UncategorizedSQLException("quota", "upsert", new SQLException("test conflict", sqlState));
    }
}

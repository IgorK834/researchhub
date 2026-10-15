package dev.researchhub.analysis.infrastructure;
import dev.researchhub.analysis.application.AnalysisStaleness.ChangedInput;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.*;
import java.sql.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class PostgresAnalysisStalenessTest {
    @Test @SuppressWarnings("unchecked") void unavailableVersionsAreRedactedWithoutReadingForeignSourceDetails() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);ResultSet row=mock(ResultSet.class);UUID workspace=UUID.randomUUID(),analysis=UUID.randomUUID();
        when(jdbc.query(anyString(),any(RowMapper.class),eq(workspace),eq(analysis))).thenAnswer(i->List.of(((RowMapper<ChangedInput>)i.getArgument(1)).mapRow(row,0)));
        var store=new PostgresAnalysisStaleness(jdbc);
        var unavailable=store.assess(workspace,analysis);assertTrue(unavailable.stale());assertEquals(List.of("INPUT_UNAVAILABLE"),unavailable.staleReasons());assertNull(unavailable.changedInputs().getFirst().originalVersion());assertNull(unavailable.changedInputs().getFirst().currentVersion());
        when(row.getObject("original_id",UUID.class)).thenReturn(UUID.randomUUID());assertNull(store.assess(workspace,analysis).changedInputs().getFirst().currentVersion());
        when(row.getObject("active_version_id",UUID.class)).thenReturn(UUID.randomUUID());assertEquals("SOURCE_REPLACED",store.assess(workspace,analysis).staleReasons().getFirst());
        when(row.getTimestamp("archived_at")).thenReturn(Timestamp.from(java.time.Instant.now()));assertEquals("WORKSPACE_ARCHIVED",store.assess(workspace,analysis).staleReasons().getFirst());
    }
}

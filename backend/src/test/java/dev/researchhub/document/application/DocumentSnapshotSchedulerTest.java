package dev.researchhub.document.application;

import java.time.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import static org.mockito.Mockito.*;

class DocumentSnapshotSchedulerTest {
    @Test void disabledSchedulerKeepsTheBeanWithoutBorrowingDatabaseConnections() {
        var documents=mock(DocumentService.class);var jdbc=mock(JdbcTemplate.class);
        var scheduler=new DocumentSnapshotScheduler(documents,jdbc,Clock.systemUTC(),Duration.ofMinutes(10));
        ReflectionTestUtils.setField(scheduler,"enabled",false);
        scheduler.checkpoint();
        verifyNoInteractions(documents,jdbc);
    }
}

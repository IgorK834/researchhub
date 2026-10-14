package dev.researchhub.document.application;

import dev.researchhub.document.infrastructure.DocumentCreationAdmission;
import dev.researchhub.shared.error.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.UUID;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class DocumentTemplateAdmissionTest {
    @Test void configuredQuotaIsBoundedAndNullCountCannotInventCapacityUsage() {
        var jdbc=mock(JdbcTemplate.class);
        for(int bad:new int[]{0,-1,10001})assertThrows(IllegalArgumentException.class,()->new DocumentCreationAdmission(jdbc,bad));
        UUID workspace=UUID.randomUUID();var admission=new DocumentCreationAdmission(jdbc,2);
        String sql="SELECT count(*) FROM documents WHERE workspace_id=? AND archived_at IS NULL";
        when(jdbc.queryForObject(sql,Integer.class,workspace)).thenReturn(0,1,2,null);
        admission.requireCapacity(workspace);admission.requireCapacity(workspace);
        assertThrows(ApiException.class,()->admission.requireCapacity(workspace));assertThrows(NullPointerException.class,()->admission.requireCapacity(workspace));
    }
}

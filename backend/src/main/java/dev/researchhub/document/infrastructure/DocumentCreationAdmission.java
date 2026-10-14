package dev.researchhub.document.infrastructure;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.util.Map;
import java.util.UUID;

/** Serializes all document creation paths, so templates cannot bypass the active-document quota. */
@Component
public class DocumentCreationAdmission {
    private final JdbcTemplate jdbc;
    private final int maximum;
    public DocumentCreationAdmission(JdbcTemplate jdbc,
            @Value("${researchhub.documents.max-active-per-workspace:100}") int maximum) {
        if (maximum < 1 || maximum > 10000) throw new IllegalArgumentException("Invalid document quota");
        this.jdbc=jdbc; this.maximum=maximum;
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public void lock(UUID workspace) {
        jdbc.query("SELECT id FROM workspaces WHERE id=? FOR UPDATE", row -> {}, workspace);
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public void requireCapacity(UUID workspace) {
        lock(workspace);
        int count=java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT count(*) FROM documents WHERE workspace_id=? AND archived_at IS NULL",Integer.class,workspace),"Document capacity could not be determined");
        if (count>=maximum) throw new ApiException(ApiErrorCode.DOCUMENT_LIMIT_REACHED,
                "The active document limit for this workspace has been reached",Map.of("documentLimit",maximum)) {
        };
    }
}

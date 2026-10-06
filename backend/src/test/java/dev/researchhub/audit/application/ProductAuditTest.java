package dev.researchhub.audit.application;

import dev.researchhub.audit.infrastructure.PostgresProductAudit;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProductAuditTest {
    @Test void metadataIsBuiltFromTypedIdsAndAllowedRolesAndNeverCopiesDocumentTextOrCode() {
        var store=mock(PostgresProductAudit.class); var json=new ObjectMapper();
        var instant=Instant.parse("2026-10-06T12:00:00Z");
        var audit=new ProductAudit(store,Clock.fixed(instant,ZoneOffset.UTC),json);
        UUID workspace=UUID.randomUUID(),actor=UUID.randomUUID(),resource=UUID.randomUUID(),version=UUID.randomUUID();
        audit.workspaceCreated(workspace,actor); audit.memberAdded(workspace,actor,resource,"VIEWER");
        audit.memberRoleChanged(workspace,actor,resource,"VIEWER","EDITOR"); audit.memberRemoved(workspace,actor,resource);
        audit.sourceUploaded(workspace,actor,resource,version,100); audit.sourceReprocessed(workspace,actor,resource,version,UUID.randomUUID());
        audit.evidenceRequested(workspace,actor,resource,version,UUID.randomUUID());
        audit.aiSuggestionAccepted(workspace,actor,resource,version,2); audit.analysisExecuted(workspace,null,resource,version,false);
        audit.commentCitationAccepted(workspace,actor,resource,version,2,"a".repeat(64));
        UUID block=UUID.randomUUID(); String empty="{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}";
        String content=json.writeValueAsString(Map.of("type","doc","content",List.of(Map.of("type","analysisResult","attrs",Map.of("blockId",block,"caption","password=secret Generated code print('secret')","reference",Map.of("analysisId",resource,"executionId",version,"outputId","result","renderMode","TABLE"))))));
        audit.documentSaved(workspace,actor,UUID.randomUUID(),1,null,content);
        audit.documentSaved(workspace,actor,UUID.randomUUID(),2,content,content); // autosave does not duplicate insertions
        audit.documentSaved(workspace,actor,UUID.randomUUID(),3,empty,content); // manual reinsertion is significant
        audit.documentSaved(workspace,actor,UUID.randomUUID(),4,content,content.replace("\"result\"","\"plot\""));
        var captor=ArgumentCaptor.forClass(ProductAudit.Event.class); verify(store,times(14)).append(captor.capture());
        var events=captor.getAllValues(); assertEquals(14,events.stream().map(ProductAudit.Event::id).distinct().count());
        assertTrue(events.stream().allMatch(e -> e.createdAt().equals(instant) && e.workspaceId().equals(workspace)));
        assertFalse(json.writeValueAsString(events).contains("secret"));
        assertTrue(events.stream().anyMatch(e -> e.actorUserId()==null));
        assertEquals(3,events.stream().filter(e -> e.eventType()==ProductAudit.Type.ANALYSIS_BLOCK_INSERTED).count());
        assertThrows(IllegalArgumentException.class,() -> audit.memberAdded(workspace,actor,resource,"password=secret"));
        assertThrows(IllegalArgumentException.class,() -> audit.memberRoleChanged(workspace,actor,resource,"EDITOR","invalid"));
        assertThrows(IllegalArgumentException.class,() -> audit.commentCitationAccepted(workspace,actor,resource,version,2,"password=secret"));
    }
}

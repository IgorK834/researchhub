package dev.researchhub.document.application;

import tools.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class DocumentTemplateContracts {
    private DocumentTemplateContracts() {}
    public record Placeholder(String id,String hint) {}
    public record Template(String id,int version,String locale,String title,String description,
            List<Placeholder> requiredPlaceholders,JsonNode content,String sha256) {
        public Template { requiredPlaceholders=List.copyOf(requiredPlaceholders);content=content.deepCopy(); }
    }
    public record Create(UUID clientRequestId,String templateId,int version,String locale,String title) {}
    public record Origin(UUID documentId,String templateId,int version,String locale,String templateSha256,
            String initialContentSha256,Instant createdAt) {}
}

package dev.researchhub.ai.application;

import static dev.researchhub.ai.application.GenerationContracts.*;

import dev.researchhub.document.application.CanvasEdit.Patch;

import java.time.Instant;
import java.util.*;

/** Authoring v2 packages are immutable server proposals, never browser-submitted editor JSON. */
public final class CanvasProposalContracts {
    private CanvasProposalContracts() {}

    public enum Mode {
        INSERT_AT_ANCHOR,
        REPLACE_RANGE
    }

    public record Proposal(
            String schemaVersion,
            UUID id,
            UUID workspaceId,
            UUID documentId,
            UUID contextId,
            UUID turnId,
            UUID supersedes,
            Mode mode,
            String state,
            String versionHash,
            String originalText,
            List<String> paragraphs,
            List<Citation> citations,
            List<String> warnings,
            AuthoringContracts.Result generation,
            ContextContracts.Summary modelContext,
            Instant createdAt,
            UUID operationId,
            @com.fasterxml.jackson.annotation.JsonInclude(
                            com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
                    UUID compensationId,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
                    CalculationPackageContracts.Content calculation) {
        public Proposal(String schemaVersion,UUID id,UUID workspaceId,UUID documentId,UUID contextId,UUID turnId,UUID supersedes,Mode mode,String state,
                String versionHash,String originalText,List<String> paragraphs,List<Citation> citations,List<String> warnings,AuthoringContracts.Result generation,
                ContextContracts.Summary modelContext,Instant createdAt,UUID operationId,UUID compensationId) {
            this(schemaVersion,id,workspaceId,documentId,contextId,turnId,supersedes,mode,state,versionHash,originalText,paragraphs,citations,warnings,generation,modelContext,createdAt,operationId,compensationId,null);
        }
        public Proposal {
            require(
                    "2.0".equals(schemaVersion)
                            && id != null
                            && workspaceId != null
                            && documentId != null
                            && (turnId != null || calculation != null)
                            && contextId != null
                            && mode != null);
            require(
                    state != null
                            && Set.of("PENDING", "ACCEPTED", "REJECTED", "SUPERSEDED")
                                    .contains(state));
            hash(versionHash);
            require(
                    originalText != null
                            && originalText.length() <= 4000
                            && (calculation!=null || generation != null && modelContext != null)
                            && createdAt != null);
            paragraphs = bounded(paragraphs, 16);
            require(!paragraphs.isEmpty());
            paragraphs.forEach(p -> GenerationContracts.text(p, 12000));
            require(paragraphs.stream().mapToInt(String::length).sum() <= 12000);
            citations = bounded(citations, 12);
            warnings = bounded(warnings, 16);
            warnings.forEach(w -> GenerationContracts.text(w, 1000));
        }

        public String text() {
            return String.join("\n\n", paragraphs);
        }

        public Proposal(
                String schemaVersion,
                UUID id,
                UUID workspaceId,
                UUID documentId,
                UUID contextId,
                UUID turnId,
                UUID supersedes,
                Mode mode,
                String state,
                String versionHash,
                String originalText,
                List<String> paragraphs,
                List<Citation> citations,
                List<String> warnings,
                AuthoringContracts.Result generation,
                ContextContracts.Summary modelContext,
                Instant createdAt,
                UUID operationId) {
            this(
                    schemaVersion,
                    id,
                    workspaceId,
                    documentId,
                    contextId,
                    turnId,
                    supersedes,
                    mode,
                    state,
                    versionHash,
                    originalText,
                    paragraphs,
                    citations,
                    warnings,
                    generation,
                    modelContext,
                    createdAt,
                    operationId,
                    null);
        }
    }

    public record Accept(UUID clientOperationId, String versionHash) {
        public Accept {
            require(clientOperationId != null);
            hash(versionHash);
        }
    }

    public record Undo(UUID clientOperationId) {
        public Undo {
            require(clientOperationId != null);
        }
    }

    public record Receipt(UUID operationId, UUID proposalId, String kind, long revision) {}

    public record Operation(
            UUID id,
            UUID workspaceId,
            UUID documentId,
            UUID callerId,
            UUID proposalId,
            String kind,
            UUID sourceOperationId,
            Long epoch,
            Patch patch,
            Receipt receipt) {}
}

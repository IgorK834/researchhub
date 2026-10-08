package dev.researchhub.support;

import java.util.List;
import org.springframework.context.ApplicationContext;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Fixed product contract; never derive this list from the beans found during startup. */
public final class RequiredProductBeans {
    private RequiredProductBeans() {}
    public static final List<String> NAMES = List.of(
        "workspaceService", "workspaceAuthorizationService", "workspaceMembershipService",
        "workspaceController", "workspaceMemberController", "workspaceRepository", "workspaceMemberRepository",
        "userRegistrationService", "userAuthenticationService", "userLookupService", "userRepository",
        "authController", "currentUserController", "currentUserResolver",
        "sourceService", "sourceExtractionService", "sourceIngestInputResolver", "sourceIngestJobStateListener",
        "sourceProcessingProgress", "sourceController", "externalSourceController", "externalSourceService",
        "sourceRepository", "sourceVersionRepository", "sourceExtractionRepository", "sourceVersionJobRepository",
        "postgresExternalSourceStore", "braveExternalSearchProvider",
        "processingJobService", "processingJobDispatcher", "postgresProcessingJobQueue", "httpProcessingWorkerClient",
        "documentService", "checkpointPolicy", "documentSnapshotScheduler", "documentProvenance",
        "documentController", "documentProvenanceController", "documentRepository", "documentVersionRepository",
        "postgresDocumentProvenance", "commentService", "commentEvidenceService", "commentEvidenceWriter",
        "commentController", "postgresCommentStore", "postgresCommentEvidence",
        "productAudit", "productAuditQuery", "reviewAudit", "productAuditController",
        "postgresProductAudit", "postgresReviewAudit", "collaborationService", "collaborationController",
        "postgresCollaborationStore", "sourceRetrievalService", "retrievalSearchService", "modelGateway",
        "groundedContextBuilder", "workspaceQuestionService", "conversationService", "conversationStreams",
        "sourceAnalysisService", "authoringService", "evidenceAssistanceService",
        "sourceRetrievalController", "retrievalSearchController", "generationController", "workspaceQuestionController",
        "conversationController", "sourceAnalysisController", "authoringController",
        "postgresRetrievalStore", "postgresRetrievalIndex", "postgresGenerationStore", "postgresConversationStore",
        "postgresSourceAnalysisStore", "postgresAuthoringStore", "httpModelProvider", "httpEmbeddingProvider",
        "aiObservation", "aiDiagnosticsStore", "aiDiagnosticsService", "aiDiagnosticsController",
        "analysisService", "executionService", "datasetPreviewService", "analysisEvidenceService",
        "analysisReproductionService", "analysisDocumentReferences", "analysisExecutionDispatcher",
        "analysisController", "datasetPreviewController", "postgresAnalysisStore", "postgresExecutionStore",
        "httpAnalysisPlanner", "exportService", "exportController", "exportDispatcher", "postgresExportStore",
        "academicReportRenderer", "exportScheduler", "costlyRequestAdmission");

    public static void assertPresent(ApplicationContext application) {
        for (String name : NAMES) assertTrue(application.containsBean(name), "Required product bean missing: " + name);
    }
}

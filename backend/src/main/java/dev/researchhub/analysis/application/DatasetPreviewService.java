package dev.researchhub.analysis.application;

import dev.researchhub.processing.application.SourceExtraction.WorkbookMetadata;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.source.application.SourceExtractionService;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.source.application.SourceVersionSummary;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.util.Set;
import java.util.UUID;

/**
 * Workspace-authorized, bounded structure of one immutable CSV/XLSX source version (RH-131).
 *
 * <p>Authorization, workspace scoping and "this version belongs to this source" are decided by the {@code source}
 * module; this service only turns the persisted worker profile into the public contract. It never opens the stored
 * file, so no workbook is parsed on the request path and no formula can run.
 */
@Service
public class DatasetPreviewService {
    private static final Set<String> TABULAR = Set.of("CSV", "XLSX");

    private final SourceService sources;
    private final SourceExtractionService extractions;
    private final ObjectMapper json;

    public DatasetPreviewService(SourceService sources, SourceExtractionService extractions, ObjectMapper json) {
        this.sources = sources;
        this.extractions = extractions;
        this.json = json;
    }

    /**
     * @throws dev.researchhub.shared.error.ResourceNotFoundException for a non-member, an unknown source, or a
     *                                                                version of a different source
     * @throws ApiException                                           {@code VALIDATION_FAILED} for a PDF/DOCX/TXT
     * @throws ConflictException                                      while the version is not {@code READY}
     */
    public DatasetPreview preview(UUID workspaceId, UUID sourceId, UUID versionId, UUID callerId) {
        SourceVersionSummary version = sources.findVersion(workspaceId, callerId, sourceId, versionId);
        if (!TABULAR.contains(version.sourceType())) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Dataset preview is available for CSV and XLSX sources");
        }
        if (!"READY".equals(version.status())) {
            throw new ConflictException("Dataset structure is not available until this version has been processed"
                    + " (" + version.status() + ")");
        }
        WorkbookMetadata workbook = extractions.findVersionWorkbook(workspaceId, sourceId, versionId, callerId);
        if (workbook == null) {
            throw new ConflictException("Dataset structure is not available for this source version");
        }
        return DatasetPreviewBuilder.build(version, workbook, json);
    }
}

package dev.researchhub.analysis.application;

import dev.researchhub.processing.application.SourceExtraction.WorkbookMetadata;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.source.application.SourceExtractionService;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.source.application.SourceVersionSummary;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The authorization and state rules around the pure projection; both collaborators are owned by {@code source}. */
class DatasetPreviewServiceTest {
    private final SourceService sources = mock(SourceService.class);
    private final SourceExtractionService extractions = mock(SourceExtractionService.class);
    private final ObjectMapper json = new ObjectMapper();
    private final DatasetPreviewService service = new DatasetPreviewService(sources, extractions, json);
    private final UUID workspace = UUID.randomUUID(), source = UUID.randomUUID(), version = UUID.randomUUID(),
            caller = UUID.randomUUID();

    private SourceVersionSummary summary(String type, String status) {
        return new SourceVersionSummary(version, source, workspace, 1, "data." + type.toLowerCase(), "x/y", type, 10,
                "ab".repeat(32), status, null, caller, Instant.EPOCH, Instant.EPOCH, true);
    }

    private WorkbookMetadata workbook() throws Exception {
        var result = json.readTree(Files.readString(Path.of("../contracts/processing/v4/source-ingest-result-csv.json")));
        return json.treeToValue(result.get("workbook"), WorkbookMetadata.class);
    }

    @Test
    void buildsThePreviewOfAReadyTabularVersionThroughTheAuthorizedSourceModule() throws Exception {
        when(sources.findVersion(workspace, caller, source, version)).thenReturn(summary("CSV", "READY"));
        when(extractions.findVersionWorkbook(workspace, source, version, caller)).thenReturn(workbook());

        var preview = service.preview(workspace, source, version, caller);

        assertEquals(version, preview.sourceVersionId());
        assertEquals("CSV", preview.format());
        assertEquals(1, preview.sheets().size());
    }

    @Test
    void anUnknownOrForeignVersionIsRefusedByTheSourceModuleBeforeAnythingIsRead() {
        when(sources.findVersion(workspace, caller, source, version)).thenThrow(new ResourceNotFoundException("Source was not found"));

        assertThrows(ResourceNotFoundException.class, () -> service.preview(workspace, source, version, caller));
        verify(extractions, never()).findVersionWorkbook(workspace, source, version, caller);
    }

    @Test
    void onlyCsvAndXlsxHaveADatasetStructure() {
        for (String type : new String[]{"PDF", "DOCX", "TXT"}) {
            when(sources.findVersion(workspace, caller, source, version)).thenReturn(summary(type, "READY"));
            ApiException refused = assertThrows(ApiException.class, () -> service.preview(workspace, source, version, caller));
            assertEquals(ApiErrorCode.VALIDATION_FAILED, refused.code());
        }
        verify(extractions, never()).findVersionWorkbook(workspace, source, version, caller);
    }

    @Test
    void aVersionThatIsNotReadyOrHasNoProfileIsAConflict() {
        for (String status : new String[]{"UPLOADED", "PROCESSING", "FAILED"}) {
            when(sources.findVersion(workspace, caller, source, version)).thenReturn(summary("CSV", status));
            ConflictException refused = assertThrows(ConflictException.class, () -> service.preview(workspace, source, version, caller));
            assertTrue(refused.getMessage().contains(status), refused.getMessage());
        }
        when(sources.findVersion(workspace, caller, source, version)).thenReturn(summary("XLSX", "READY"));
        when(extractions.findVersionWorkbook(workspace, source, version, caller)).thenReturn(null);
        assertThrows(ConflictException.class, () -> service.preview(workspace, source, version, caller));
        assertSame(ApiErrorCode.CONFLICT, new ConflictException("x").code());
    }
}

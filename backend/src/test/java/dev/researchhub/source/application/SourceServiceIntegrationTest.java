package dev.researchhub.source.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.PayloadTooLargeException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.shared.error.UnsupportedFileTypeException;
import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import dev.researchhub.workspace.UserRowFixture;
import dev.researchhub.workspace.application.AddWorkspaceMemberCommand;
import dev.researchhub.workspace.application.CreateWorkspaceCommand;
import dev.researchhub.workspace.application.WorkspaceMembershipService;
import dev.researchhub.workspace.application.WorkspaceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link SourceService} against a real database, with the in-memory storage adapter behind the port.
 *
 * <p>The service is only created when a storage adapter is configured, so this test configures one: the property
 * names it, and the nested configuration provides it. That is exactly how RH-072's local adapter will be selected.
 */
@PostgresIntegrationTest
@TestPropertySource(properties = {
        "researchhub.sources.storage.adapter=in-memory",
        "researchhub.sources.max-size-bytes=1024",
        "researchhub.processing.dispatcher.enabled=false"
})
class SourceServiceIntegrationTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageConfiguration {

        @Bean
        InMemorySourceStorage inMemorySourceStorage() {
            return new InMemorySourceStorage();
        }

        @Bean
        @Primary
        AdjustableQuota adjustableQuota() {
            return new AdjustableQuota();
        }

    }

    /** A quota the test can lower, standing in for a future real one. */
    static class AdjustableQuota implements WorkspaceSourceQuota {

        long remainingBytes = Long.MAX_VALUE;

        @Override
        public void requireCapacity(UUID workspaceId, long incomingBytes) {
            if (incomingBytes > remainingBytes) {
                throw new PayloadTooLargeException("The workspace has no room for another " + incomingBytes
                        + " bytes");
            }
        }

    }

    private static final byte[] PDF = "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);

    @Autowired
    private SourceService sources;

    @Autowired
    private InMemorySourceStorage storage;

    @Autowired
    private AdjustableQuota quota;

    @Autowired
    private WorkspaceService workspaces;

    @Autowired
    private WorkspaceMembershipService memberships;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private UUID owner;
    private UUID workspaceId;

    @BeforeEach
    void workspaceWithAnOwner() {
        storage.clear();
        quota.remainingBytes = Long.MAX_VALUE;
        owner = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada Lovelace");
        workspaceId = workspaces.create(new CreateWorkspaceCommand("Electronics Lab", null, owner)).id();
    }

    private UUID member(String email, String role) {
        UUID user = UserRowFixture.insertUser(jdbcTemplate, email, "Member");
        memberships.addMember(workspaceId, owner, new AddWorkspaceMemberCommand(email, role));
        return user;
    }

    private static UploadSourceCommand upload(String filename, String mediaType, byte[] content) {
        return new UploadSourceCommand(filename, mediaType, (long) content.length, new ByteArrayInputStream(content));
    }

    private int rows() {
        Integer count = jdbcTemplate.queryForObject("SELECT count(*) FROM sources", Integer.class);
        return count == null ? 0 : count;
    }

    // --- uploading ---

    @Test
    void storesTheBytesAndRecordsAnUploadedSource() throws IOException {
        SourceSummary source = sources.upload(workspaceId, owner, upload("Lab report.pdf", "application/pdf", PDF));

        assertEquals("Lab report.pdf", source.originalFilename());
        assertEquals("Lab report.pdf", source.displayName());
        assertEquals("PDF", source.sourceType());
        assertEquals("application/pdf", source.mediaType());
        assertEquals(PDF.length, source.sizeBytes());
        assertEquals("UPLOADED", source.status());
        assertEquals(owner, source.uploadedBy());
        assertEquals(workspaceId, source.workspaceId());
        assertEquals(64, source.contentSha256().length());

        assertEquals(1, jdbcTemplate.queryForObject("""
                SELECT count(*) FROM processing_jobs
                WHERE workspace_id = ? AND job_type = 'SOURCE_INGEST' AND resource_type = 'SOURCE'
                  AND resource_id = ? AND status = 'PENDING' AND attempt_count = 0
                """, Integer.class, workspaceId, source.id()));

        String key = jdbcTemplate.queryForObject("SELECT storage_key FROM sources WHERE id = ?", String.class,
                source.id());
        assertTrue(key.startsWith("sources/") && !key.contains("Lab report"),
                "the key is generated, never built from the file name: " + key);
        SourceContent content = sources.openContent(workspaceId, owner, source.id());
        assertEquals(source, content.source());
        try (InputStream stored = content.content()) {
            assertArrayEquals(PDF, stored.readAllBytes());
        }
    }

    @Test
    void storesTheCanonicalMediaTypeRatherThanTheClaimedOne() {
        SourceSummary csv = sources.upload(workspaceId, owner,
                upload("data.csv", "application/vnd.ms-excel", "a,b\n1,2\n".getBytes(StandardCharsets.UTF_8)));

        assertEquals("CSV", csv.sourceType());
        assertEquals("text/csv", csv.mediaType());
    }

    @Test
    void aPathInTheFileNameIsJustMetadata() {
        SourceSummary source = sources.upload(workspaceId, owner,
                upload("../../etc/passwd.txt", "text/plain", "root:x:0:0".getBytes(StandardCharsets.UTF_8)));

        assertEquals("passwd.txt", source.originalFilename());
    }

    @Test
    void anUnsupportedTypeIsAClearErrorAndStoresNothing() {
        UnsupportedFileTypeException refused = assertThrows(UnsupportedFileTypeException.class,
                () -> sources.upload(workspaceId, owner, upload("run.exe", null, new byte[]{'M', 'Z'})));

        assertEquals(ApiErrorCode.UNSUPPORTED_FILE_TYPE, refused.code());
        assertTrue(refused.getMessage().contains("Supported types: PDF (.pdf)"), refused.getMessage());
        assertEquals(0, storage.objectCount());
        assertEquals(0, rows());
    }

    @Test
    void contentThatDoesNotMatchItsExtensionIsRefusedBeforeStoring() {
        UnsupportedFileTypeException refused = assertThrows(UnsupportedFileTypeException.class,
                () -> sources.upload(workspaceId, owner, upload("invoice.pdf", "application/pdf",
                        new byte[]{'M', 'Z', (byte) 0x90, 0})));

        assertTrue(refused.getMessage().contains("its content is not a PDF file"), refused.getMessage());
        assertEquals(0, storage.objectCount());
        assertEquals(0, rows());
    }

    @Test
    void anEmptyFileIsRefused() {
        ApiException refused = assertThrows(ApiException.class,
                () -> sources.upload(workspaceId, owner, upload("empty.txt", "text/plain", new byte[0])));

        assertEquals(ApiErrorCode.VALIDATION_FAILED, refused.code());
        assertEquals(0, storage.objectCount());
    }

    @Test
    void aMissingFileNameIsAValidationError() {
        ApiException refused = assertThrows(ApiException.class,
                () -> sources.upload(workspaceId, owner, upload("  ", "text/plain", "x".getBytes())));

        assertEquals(ApiErrorCode.VALIDATION_FAILED, refused.code());
        assertTrue(refused.getMessage().startsWith("The file name is not usable"), refused.getMessage());
    }

    @Test
    void aDeclaredSizeOverTheLimitIsRefusedBeforeReadingAnything() {
        InputStream untouchable = new InputStream() {
            @Override
            public int read() {
                throw new AssertionError("the body must not be read");
            }
        };

        PayloadTooLargeException refused = assertThrows(PayloadTooLargeException.class,
                () -> sources.upload(workspaceId, owner,
                        new UploadSourceCommand("big.txt", "text/plain", 1025L, untouchable)));

        assertEquals(ApiErrorCode.PAYLOAD_TOO_LARGE, refused.code());
        assertEquals("The file is larger than the 1024 bytes allowed for one source", refused.getMessage());
    }

    @Test
    void aBodyLargerThanItClaimedIsStoppedWhileStreamingAndCleanedUp() {
        byte[] large = "x".repeat(4096).getBytes(StandardCharsets.UTF_8);

        assertThrows(PayloadTooLargeException.class, () -> sources.upload(workspaceId, owner,
                new UploadSourceCommand("big.txt", "text/plain", null, new ByteArrayInputStream(large))));

        assertEquals(0, storage.objectCount(), "the partial object is removed");
        assertEquals(0, rows());
    }

    @Test
    void theWorkspaceQuotaIsAskedAndARefusalRemovesTheStoredBytes() {
        quota.remainingBytes = 10;

        assertThrows(PayloadTooLargeException.class, () -> sources.upload(workspaceId, owner,
                new UploadSourceCommand("notes.txt", "text/plain", null,
                        new ByteArrayInputStream("more than ten bytes".getBytes(StandardCharsets.UTF_8)))));
        assertThrows(PayloadTooLargeException.class, () -> sources.upload(workspaceId, owner,
                upload("notes.txt", "text/plain", "more than ten bytes".getBytes(StandardCharsets.UTF_8))),
                "and a declared size is checked before reading");

        assertEquals(0, storage.objectCount());
        assertEquals(0, rows());
    }

    @Test
    void aStorageFailureRecordsNothing() {
        storage.failNextStore();

        assertThrows(UncheckedIOException.class,
                () -> sources.upload(workspaceId, owner, upload("report.pdf", "application/pdf", PDF)));

        assertEquals(0, rows());
        assertEquals(0, storage.objectCount());
    }

    @Test
    void aCleanUpFailureDoesNotHideTheReasonTheUploadFailed() {
        storage.failDeletes(true);
        byte[] large = "x".repeat(4096).getBytes(StandardCharsets.UTF_8);

        assertThrows(PayloadTooLargeException.class, () -> sources.upload(workspaceId, owner,
                new UploadSourceCommand("big.txt", "text/plain", null, new ByteArrayInputStream(large))));
    }

    @Test
    void eachUploadIsItsOwnSourceEvenForTheSameFile() {
        SourceSummary first = sources.upload(workspaceId, owner, upload("report.pdf", "application/pdf", PDF));
        SourceSummary second = sources.upload(workspaceId, owner, upload("report.pdf", "application/pdf", PDF));

        assertFalse(first.id().equals(second.id()), "a replacement is new material, never a mutation");
        assertEquals(first.contentSha256(), second.contentSha256(), "and the hash says they are the same bytes");
        assertEquals(2, storage.objectCount());
    }

    // --- authorization ---

    @Test
    void anEditorMayUploadAndAViewerMayNot() {
        UUID editor = member("editor@example.com", "EDITOR");
        UUID viewer = member("viewer@example.com", "VIEWER");

        assertEquals("UPLOADED", sources.upload(workspaceId, editor, upload("a.txt", "text/plain",
                "a".getBytes())).status());
        assertThrows(ForbiddenException.class,
                () -> sources.upload(workspaceId, viewer, upload("b.txt", "text/plain", "b".getBytes())));
        assertEquals(1, storage.objectCount(), "the viewer's bytes were never read into storage");
    }

    @Test
    void aNonMemberGetsTheSameNotFoundForEverything() {
        SourceSummary source = sources.upload(workspaceId, owner, upload("a.txt", "text/plain", "a".getBytes()));
        UUID stranger = UserRowFixture.insertUser(jdbcTemplate, "mallory@example.com", "Mallory");

        for (Runnable attempt : List.<Runnable>of(
                () -> sources.upload(workspaceId, stranger, upload("b.txt", "text/plain", "b".getBytes())),
                () -> sources.list(workspaceId, stranger),
                () -> sources.findOne(workspaceId, stranger, source.id()),
                () -> sources.openContent(workspaceId, stranger, source.id()))) {
            ResourceNotFoundException refused = assertThrows(ResourceNotFoundException.class, attempt::run);
            assertEquals("Source was not found", refused.getMessage());
        }
    }

    @Test
    void aSourceIsReachableOnlyThroughItsOwnWorkspace() {
        SourceSummary source = sources.upload(workspaceId, owner, upload("a.txt", "text/plain", "a".getBytes()));
        UUID otherWorkspace = workspaces.create(new CreateWorkspaceCommand("Other", null, owner)).id();

        assertThrows(ResourceNotFoundException.class, () -> sources.findOne(otherWorkspace, owner, source.id()),
                "even for somebody who belongs to both");
        assertThrows(ResourceNotFoundException.class, () -> sources.openContent(otherWorkspace, owner, source.id()));
    }

    @Test
    void anArchivedWorkspaceTakesNoNewSourcesButKeepsItsOld() {
        SourceSummary source = sources.upload(workspaceId, owner, upload("a.txt", "text/plain", "a".getBytes()));
        workspaces.archive(workspaceId, owner);

        assertThrows(ConflictException.class,
                () -> sources.upload(workspaceId, owner, upload("b.txt", "text/plain", "b".getBytes())));
        assertEquals(List.of(source.id()), sources.list(workspaceId, owner).stream().map(SourceSummary::id).toList());
    }

    // --- reading ---

    @Test
    void listsNewestFirstAndAViewerCanRead() {
        UUID viewer = member("viewer@example.com", "VIEWER");
        SourceSummary first = sources.upload(workspaceId, owner, upload("first.txt", "text/plain", "1".getBytes()));
        SourceSummary second = sources.upload(workspaceId, owner, upload("second.txt", "text/plain", "2".getBytes()));

        List<SourceSummary> listed = sources.list(workspaceId, viewer);

        assertEquals(2, listed.size());
        assertTrue(listed.getFirst().createdAt().compareTo(listed.getLast().createdAt()) >= 0);
        assertEquals(second, sources.findOne(workspaceId, viewer, second.id()));
        assertEquals(first.id(), sources.findOne(workspaceId, viewer, first.id()).id());
    }

    @Test
    void bytesMissingFromStorageAreAnOperationalFaultNotANotFound() {
        SourceSummary source = sources.upload(workspaceId, owner, upload("a.txt", "text/plain", "a".getBytes()));
        storage.clear();

        UncheckedIOException failure = assertThrows(UncheckedIOException.class,
                () -> sources.openContent(workspaceId, owner, source.id()));
        assertTrue(failure.getCause() instanceof StorageObjectNotFoundException);
    }

}

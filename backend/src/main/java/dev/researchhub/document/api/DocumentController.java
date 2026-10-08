package dev.researchhub.document.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.document.application.CreateDocumentCommand;
import dev.researchhub.document.application.DocumentService;
import dev.researchhub.document.application.ReviseDocumentCommand;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.UUID;

/**
 * Document endpoints, nested under the workspace that owns them.
 *
 * <table>
 *   <caption>Routes</caption>
 *   <tr><th>Endpoint</th><th>Needs</th><th>Answers</th></tr>
 *   <tr><td>{@code POST   .../documents}</td><td>{@code EDIT_CONTENT}</td><td>201, revision 1</td></tr>
 *   <tr><td>{@code GET    .../documents}</td><td>{@code VIEW_CONTENT}</td><td>Summaries of active documents, no content</td></tr>
 *   <tr><td>{@code GET    .../documents/{documentId}}</td><td>{@code VIEW_CONTENT}</td><td>The document with its content</td></tr>
 *   <tr><td>{@code PATCH  .../documents/{documentId}}</td><td>{@code EDIT_CONTENT}</td><td>200 with the next revision, or 409</td></tr>
 *   <tr><td>{@code DELETE .../documents/{documentId}}</td><td>{@code EDIT_CONTENT}</td><td>204, soft archive</td></tr>
 *   <tr><td>{@code GET    .../documents/{documentId}/versions}</td><td>{@code VIEW_CONTENT}</td><td>The history, newest first, no content</td></tr>
 *   <tr><td>{@code GET    .../documents/{documentId}/versions/{versionId}}</td><td>{@code VIEW_CONTENT}</td><td>One version with its content</td></tr>
 *   <tr><td>{@code POST   .../documents/{documentId}/versions/{versionId}/restore}</td><td>{@code EDIT_CONTENT}</td><td>200 with a new revision holding the old text, or 409</td></tr>
 * </table>
 *
 * <p>The URL says what the authorization is: a document lives under a workspace, so the caller's membership of
 * that workspace is what decides. A viewer may read and gets {@code 403} on the three writes; a non-member gets
 * {@code 404}, with the same detail as a document that does not exist and as a document belonging to another
 * workspace. That last case is the one worth stating plainly — substituting a workspace id in the path does not
 * reveal that the other workspace or its document is there.
 *
 * <p>{@code DELETE} archives rather than deletes. The row, its text, and its revision all survive, and the
 * document stays readable by id; it only leaves the list. Authored prose is the product, so nothing here
 * removes a row.
 *
 * <p>All five require a session, granted by nothing here: the filter chain authenticates every request that is
 * not explicitly permitted, so an anonymous call is {@code 401} before this class runs. The three mutating
 * routes also need the CSRF header.
 *
 * <p>This is persistence for direct authoring, not collaborative editing. There is no websocket, no CRDT, and no
 * presence — docs/context.md section 9 describes that as a later stage, and {@code revision} is the honest
 * single-writer answer until then.
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/documents")
public class DocumentController {

    private final DocumentService documents;
    private final CurrentUserResolver currentUserResolver;
    private final ObjectMapper objectMapper;

    public DocumentController(DocumentService documents, CurrentUserResolver currentUserResolver,
                              ObjectMapper objectMapper) {
        this.documents = documents;
        this.currentUserResolver = currentUserResolver;
        this.objectMapper = objectMapper;
    }

    /** Creates a document. Returns 201 with revision 1. */
    @PostMapping
    ResponseEntity<DocumentResponse> create(@PathVariable UUID workspaceId,
                                            @Valid @RequestBody CreateDocumentRequest request) {
        DocumentResponse created = DocumentResponse.from(
                documents.create(workspaceId, currentUserId(),
                        new CreateDocumentCommand(request.title(), request.content().toString())),
                objectMapper);

        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * The workspace's active documents, most recently updated first.
     *
     * <p>Summaries only. Archived documents are left out by the query; they remain reachable by id.
     */
    @GetMapping
    List<DocumentSummaryResponse> list(@PathVariable UUID workspaceId) {
        return documents.list(workspaceId, currentUserId()).stream()
                .map(DocumentSummaryResponse::from)
                .toList();
    }

    /**
     * One document with its content, including an archived one so its text is never out of reach.
     *
     * <p>The document must belong to {@code workspaceId}. One that does not is {@code 404}, even for a caller
     * who is a member of both workspaces.
     */
    @GetMapping("/{documentId}")
    DocumentResponse get(@PathVariable UUID workspaceId, @PathVariable UUID documentId) {
        return DocumentResponse.from(
                documents.findOne(workspaceId, currentUserId(), documentId), objectMapper);
    }

    /**
     * Saves the next revision. Returns 200 with {@code revision} incremented.
     *
     * <p>The body's {@code revision} is what the editor last saw. If the stored document has moved on, the
     * answer is {@code 409} and nothing is written. The response carries the stored revision as
     * {@code currentRevision}, next to a detail that says the same in words, so the client can explain the
     * situation rather than just failing. It does not carry the stored content; the client reloads that with
     * {@code GET} when the user chooses to.
     */
    @PatchMapping("/{documentId}")
    DocumentResponse update(@PathVariable UUID workspaceId, @PathVariable UUID documentId,
                            @Valid @RequestBody UpdateDocumentRequest request) {
        return DocumentResponse.from(
                documents.revise(workspaceId, currentUserId(), documentId,
                        new ReviseDocumentCommand(request.title(), request.content().toString(),
                                request.revision(), request.saveKind())),
                objectMapper);
    }

    /**
     * Archives the document. Returns 204, and again on a second call — archiving something already archived is
     * the state the caller asked for.
     */
    @DeleteMapping("/{documentId}")
    ResponseEntity<Void> archive(@PathVariable UUID workspaceId, @PathVariable UUID documentId) {
        documents.archive(workspaceId, currentUserId(), documentId);

        return ResponseEntity.noContent().build();
    }

    /**
     * The document's history, newest first. Summaries only; one version's text is a separate request.
     *
     * <p>Readable by any member, on an archived document too.
     */
    @GetMapping("/{documentId}/versions")
    List<DocumentVersionSummaryResponse> versions(@PathVariable UUID workspaceId, @PathVariable UUID documentId) {
        return documents.listVersions(workspaceId, currentUserId(), documentId).stream()
                .map(DocumentVersionSummaryResponse::from)
                .toList();
    }

    /** One version with its content. A version of another document is {@code 404}, like a missing one. */
    @GetMapping("/{documentId}/versions/{versionId}")
    DocumentVersionResponse version(@PathVariable UUID workspaceId, @PathVariable UUID documentId,
                                    @PathVariable UUID versionId) {
        return DocumentVersionResponse.from(
                documents.findVersion(workspaceId, currentUserId(), documentId, versionId), objectMapper);
    }

    /**
     * Restores a version: its text becomes the document's next revision. Returns 200 with the document.
     *
     * <p>Nothing is deleted. The new revision is recorded as a {@code RESTORE} version naming the one it came from,
     * and every version in between stays in the history. A stale {@code revision} is {@code 409} with
     * {@code currentRevision}, like a save.
     */
    @PostMapping("/{documentId}/versions/{versionId}/restore")
    DocumentResponse restore(@PathVariable UUID workspaceId, @PathVariable UUID documentId,
                             @PathVariable UUID versionId,
                             @Valid @RequestBody RestoreDocumentVersionRequest request) {
        return DocumentResponse.from(
                documents.restore(workspaceId, currentUserId(), documentId, versionId, request.revision()),
                objectMapper);
    }

    public record NamedSnapshotRequest(@jakarta.validation.constraints.Min(1) long revision,
            @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=120) String name) {}
    @PostMapping("/{documentId}/snapshots")
    ResponseEntity<DocumentVersionSummaryResponse> snapshot(@PathVariable UUID workspaceId,@PathVariable UUID documentId,
            @Valid @RequestBody NamedSnapshotRequest input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(DocumentVersionSummaryResponse.from(documents.namedSnapshot(workspaceId,currentUserId(),documentId,input.revision(),input.name())));
    }

    private UUID currentUserId() {
        return currentUserResolver.requireCurrentUser().id();
    }

}

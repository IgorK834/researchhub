package dev.researchhub.source.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.source.domain.BibliographicMetadata;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.source.application.ExternalSourceContracts.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Service
public class ExternalSourceService {
    private final WorkspaceAuthorizationService authorization;
    private final ExternalSearchProvider provider;
    private final ExternalSourceStore store;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final Clock clock;

    public ExternalSourceService(WorkspaceAuthorizationService authorization, ExternalSearchProvider provider,
                                 ExternalSourceStore store, PlatformTransactionManager manager, ObjectMapper json, Clock clock) {
        this.authorization = authorization; this.provider = provider; this.store = store;
        this.transactions = new TransactionTemplate(manager); this.json = json; this.clock = clock;
    }

    public Availability availability(UUID workspaceId, UUID userId) {
        authorization.requireContentReader(workspaceId, userId);
        return new Availability(provider.available(), provider.name());
    }

    public Search search(UUID workspaceId, UUID userId, SearchCommand command) {
        authorization.requireContentEditor(workspaceId, userId);
        if (!Boolean.TRUE.equals(command.externalSearchEnabled()))
            throw invalid("Explicitly enable external search for this request");
        String query = command.query() == null ? "" : command.query().strip();
        if (query.isEmpty() || query.length() > 600 || query.split("\\s+").length > 75
                || query.codePoints().anyMatch(c -> Character.isISOControl(c) || Character.getType(c) == Character.FORMAT))
            throw invalid("External search requires 1–600 characters and at most 75 words without control characters");
        if (!provider.available())
            throw new ApiException(ApiErrorCode.EXTERNAL_SEARCH_UNAVAILABLE, "External search is not configured on this server");
        List<Result> results = provider.search(query);
        Search search = new Search(UUID.randomUUID(), workspaceId, EvidenceType.EXTERNAL_WEB, provider.name(),
                query, userId, clock.instant(), results);
        // Provider I/O occurs without a database transaction. Recheck after it, before persistence/publication.
        return transactions.execute(status -> {
            authorization.requireContentEditor(workspaceId, userId);
            return store.saveSearch(search);
        });
    }

    public Reference record(UUID workspaceId, UUID userId, RecordCommand command) {
        return transactions.execute(status -> {
            authorization.requireContentEditor(workspaceId, userId);
            if (command.searchId() == null || command.resultId() == null) throw invalid("Choose a discovered result to record");
            Search search = store.findSearch(workspaceId, command.searchId());
            Result result = search.results().stream().filter(hit -> hit.id().equals(command.resultId())).findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException("External result was not found"));
            String hash = digest(json.writeValueAsString(List.of(search, result)));
            return store.record(new Reference(UUID.randomUUID(), workspaceId, EvidenceType.EXTERNAL_WEB,
                    search.provider(), search.query(), search.id(), result.id(), result.title(), result.url(), result.snippet(),
                    search.searchedBy(), search.searchedAt(), userId, clock.instant(), hash));
        });
    }

    public Page list(UUID workspaceId, UUID userId, String pageValue, String sizeValue) {
        authorization.requireContentReader(workspaceId, userId);
        try {
            int page = Integer.parseInt(pageValue), size = Integer.parseInt(sizeValue);
            if (page < 0 || page > 1_000_000 || size < 1 || size > 100) throw new IllegalArgumentException();
            return store.list(workspaceId, page, size);
        } catch (IllegalArgumentException badPage) { throw invalid("Page must be 0–1000000 and size 1–100"); }
    }

    /** Shared validation for provider-derived metadata; its text remains untrusted data. */
    public static Result validatedResult(String title, String url, String snippet) {
        var metadata = new BibliographicMetadata(title, List.of(), null, null, null, url, null);
        if (metadata.title() == null || metadata.url() == null || snippet == null || snippet.length() > 4000
                || snippet.codePoints().anyMatch(c -> Character.isISOControl(c) && c != '\n' && c != '\t'))
            throw new IllegalArgumentException("Invalid external result");
        return new Result(UUID.randomUUID(), metadata.title(), metadata.url(), snippet.strip());
    }

    private static String digest(String snapshot) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(snapshot.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static ApiException invalid(String message) { return new ApiException(ApiErrorCode.VALIDATION_FAILED, message); }
}

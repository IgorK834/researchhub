package dev.researchhub.search.application;

import dev.researchhub.search.application.WorkspaceSearchContracts.Cursor;
import dev.researchhub.search.application.WorkspaceSearchContracts.Page;
import dev.researchhub.search.application.WorkspaceSearchContracts.Result;
import dev.researchhub.search.application.WorkspaceSearchContracts.Type;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class WorkspaceSearchService {
    private static final int MAX_QUERY = 200;
    private final WorkspaceSearchStore store;
    private final WorkspaceAuthorizationService authorization;

    public WorkspaceSearchService(WorkspaceSearchStore store, WorkspaceAuthorizationService authorization) {
        this.store = store;
        this.authorization = authorization;
    }

    @Transactional(readOnly = true)
    public Page search(UUID workspaceId, UUID callerId, String rawQuery, String rawTypes,
                       String encodedCursor, int limit) {
        authorization.requireContentReader(workspaceId, callerId);
        String query = rawQuery == null ? "" : rawQuery.strip();
        if (query.isEmpty() || query.length() > MAX_QUERY || query.codePoints().anyMatch(Character::isISOControl))
            throw invalid("Search text must contain 1–200 characters without control characters");
        if (limit < 1 || limit > 50) throw invalid("Search limit must be between 1 and 50");
        Set<Type> types = types(rawTypes);
        String scope = scope(workspaceId+"\n"+callerId+"\n"+query, types);
        Cursor cursor = decode(encodedCursor, scope);
        var hits = store.search(workspaceId, callerId, query, types, cursor, limit + 1);
        var visible = hits.stream().limit(limit).map(hit -> new Result(hit.type(), hit.id(), hit.title(),
                snippet(hit.content(), query), hit.location(), hit.sourceVersion(), hit.updatedAt())).toList();
        String next = hits.size() > limit ? encode(scope, visible.getLast()) : null;
        return new Page(visible, next);
    }

    private static Set<Type> types(String raw) {
        if (raw == null || raw.isBlank()) return Set.of();
        var result = new LinkedHashSet<Type>();
        try {
            for (String value : raw.split(",")) result.add(Type.valueOf(value.strip().toUpperCase(Locale.ROOT)));
        } catch (IllegalArgumentException invalid) {
            throw invalid("Search types may only contain DOCUMENT, SOURCE, CONVERSATION, COMMENT, or ANALYSIS");
        }
        return Set.copyOf(result);
    }

    static String snippet(String content, String query) {
        String text = (content == null ? "" : content).replaceAll("\\s+", " ").strip();
        if (text.isEmpty()) return "";
        int at = Integer.MAX_VALUE;
        String lower = text.toLowerCase(Locale.ROOT);
        for (String token : query.toLowerCase(Locale.ROOT).split("[^\\p{L}\\p{N}]+")) {
            if (token.length() < 2) continue;
            int found = lower.indexOf(token);
            if (found >= 0) at = Math.min(at, found);
        }
        if (at == Integer.MAX_VALUE) at = 0;
        int start = Math.max(0, at - 90);
        int end = Math.min(text.length(), start + 300);
        if (start > 0) {
            int space = text.indexOf(' ', start);
            if (space >= 0 && space < end) start = space + 1;
        }
        String excerpt = text.substring(start, end).strip();
        return (start > 0 ? "…" : "") + excerpt + (end < text.length() ? "…" : "");
    }

    private static String scope(String query, Set<Type> types) {
        String sorted = types.stream().map(Enum::name).sorted(Comparator.naturalOrder()).reduce((a, b) -> a + "," + b).orElse("");
        return hash(query.toLowerCase(Locale.ROOT) + "\n" + sorted).substring(0, 16);
    }

    private static String encode(String scope, Result result) {
        String raw = scope + "|" + result.updatedAt() + "|" + result.type() + "|" + result.id();
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private static Cursor decode(String value, String expectedScope) {
        if (value == null || value.isBlank()) return null;
        if(value.length()>512)throw invalid("Search cursor is too long");
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", -1);
            if (parts.length != 4 || !expectedScope.equals(parts[0])) throw new IllegalArgumentException();
            return new Cursor(Instant.parse(parts[1]), Type.valueOf(parts[2]), UUID.fromString(parts[3]));
        } catch (IllegalArgumentException | DateTimeParseException invalid) {
            throw invalid("Search cursor is invalid for this query");
        }
    }

    private static String hash(String value) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static ApiException invalid(String detail) {
        return new ApiException(ApiErrorCode.VALIDATION_FAILED, detail);
    }
}

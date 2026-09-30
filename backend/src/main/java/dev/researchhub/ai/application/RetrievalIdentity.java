package dev.researchhub.ai.application;

import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;

/** Cross-runtime identity: SHA-256 of UTF-8 text or compact UTF-8 JSON arrays. */
public final class RetrievalIdentity {
    private static final ObjectMapper JSON = new ObjectMapper();
    private RetrievalIdentity() {}
    public static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    public static String digest(Object... fields) { return hash(JSON.writeValueAsString(Arrays.asList(fields))); }
    public static String chunkId(RetrievalChunk chunk) {
        return digest(chunk.workspaceId().toString(), chunk.sourceId().toString(),
                chunk.sourceVersionId() == null ? null : chunk.sourceVersionId().toString(), chunk.processingVersion(),
                chunk.chunkIndex(), chunk.contentHash(), chunk.spans().stream()
                        .map(span -> Arrays.asList(span.unitId(), span.characterStart(), span.characterEnd())).toList());
    }
}

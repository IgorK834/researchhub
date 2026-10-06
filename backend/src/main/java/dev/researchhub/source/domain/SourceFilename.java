package dev.researchhub.source.domain;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The name the uploader's file had, reduced to safe metadata.
 *
 * <p><strong>Metadata only.</strong> This value is shown to people and nothing else: it never becomes part of a
 * storage key, a path, or a header without encoding. The storage key is generated independently
 * ({@link StorageKey}), so a name like {@code ../../etc/passwd} is harmless text, not a location.
 *
 * <p>Even so, what is kept is cleaned, because it is rendered in lists and downloads:
 *
 * <ul>
 *   <li>any directory part is dropped — browsers on some platforms send a full path, and nothing needs it,
 *   <li>Unicode is normalised to NFC, so the same visible name is the same string,
 *   <li>control characters and bidirectional overrides are removed — the latter can make {@code gpj.exe} display
 *       as {@code exe.jpg},
 *   <li>surrounding whitespace is trimmed,
 *   <li>and what remains must be non-empty, not {@code .} or {@code ..}, and at most {@link #MAX_LENGTH} characters.
 * </ul>
 */
public record SourceFilename(String value) {

    /** Mirrors {@code sources.original_filename varchar(255)}, and FieldLengths.NAME_MAX. */
    public static final int MAX_LENGTH = 255;

    private static final Pattern UNSAFE = Pattern.compile("[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Zl}\\p{Zp}]");

    public SourceFilename {
        if (value == null || value.isBlank() || value.equals(".") || value.equals("..")) {
            throw new IllegalArgumentException("a file name is required");
        }
        if (value.length() > MAX_LENGTH) throw new IllegalArgumentException("a file name is too long");
        if (!value.equals(clean(value))) {
            throw new IllegalArgumentException("a file name must already be cleaned; use SourceFilename.of");
        }
    }

    /**
     * Cleans what the client sent.
     *
     * @throws IllegalArgumentException when nothing usable is left, or the name is too long
     */
    public static SourceFilename of(String raw) {
        if (raw == null) {
            throw new IllegalArgumentException("a file name is required");
        }
        String cleaned = clean(raw);
        if (cleaned.isEmpty() || cleaned.equals(".") || cleaned.equals("..")) {
            throw new IllegalArgumentException("a file name is required");
        }
        if (cleaned.length() > MAX_LENGTH) {
            throw new IllegalArgumentException("a file name must be at most " + MAX_LENGTH + " characters");
        }
        return new SourceFilename(cleaned);
    }

    private static String clean(String raw) {
        String lastSegment = raw.substring(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1);
        String normalized = Normalizer.normalize(lastSegment, Normalizer.Form.NFC);
        return UNSAFE.matcher(normalized).replaceAll("").replaceAll("[<>:\"|?*]", "_").strip();
    }

    /** The extension after the last dot, lowercase, or empty when there is none. */
    public Optional<String> extension() {
        int dot = value.lastIndexOf('.');
        if (dot <= 0 || dot == value.length() - 1) {
            return Optional.empty();
        }
        return Optional.of(value.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

}

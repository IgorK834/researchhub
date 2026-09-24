package dev.researchhub.source.domain;

import dev.researchhub.shared.error.UnsupportedFileTypeException;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The kinds of file a workspace accepts as a source, and how an upload is recognised as one.
 *
 * <p>The mapping is closed and documented in docs/development/sources.md. Each type has exactly one extension, one
 * canonical media type — the one stored, pinned by {@code ck_sources_media_type_matches_type} — a set of media types
 * a browser may send for it, and a check of the file's first bytes.
 *
 * <p>Recognition deliberately uses all three signals, in this order:
 *
 * <ol>
 *   <li>The <strong>extension</strong> decides the type. It is the one signal every browser sends consistently.
 *   <li>The <strong>declared media type</strong> must agree with it, or be absent or generic
 *       ({@code application/octet-stream}). A {@code .pdf} sent as {@code image/png} is refused rather than
 *       guessed at.
 *   <li>The <strong>content</strong> must look like the type ({@link #acceptsLeadingBytes}). A renamed executable
 *       is not a PDF because its name ends in {@code .pdf}.
 * </ol>
 *
 * <p>Anything else is {@code UNSUPPORTED_FILE_TYPE} with a detail that names what was sent and what is supported.
 */
public enum SourceType {

    PDF("pdf", "application/pdf", Set.of("application/pdf", "application/x-pdf"), Signature.PDF),

    DOCX("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Set.of("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), Signature.ZIP),

    XLSX("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Set.of("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), Signature.ZIP),

    /**
     * Browsers disagree about CSV: Windows commonly labels it {@code application/vnd.ms-excel}, and some send
     * {@code text/plain}. All of those are accepted for a {@code .csv}; what is stored is {@code text/csv}.
     */
    CSV("csv", "text/csv",
            Set.of("text/csv", "application/csv", "text/x-csv", "text/plain", "application/vnd.ms-excel"),
            Signature.TEXT),

    TXT("txt", "text/plain", Set.of("text/plain"), Signature.TEXT);

    /** A media type that says nothing about the content. Accepted for every type; the extension decides. */
    private static final String GENERIC_MEDIA_TYPE = "application/octet-stream";

    /** How many leading bytes {@link #acceptsLeadingBytes} looks at. */
    public static final int SIGNATURE_WINDOW_BYTES = 8192;

    private final String extension;
    private final String mediaType;
    private final Set<String> acceptedMediaTypes;
    private final Signature signature;

    SourceType(String extension, String mediaType, Set<String> acceptedMediaTypes, Signature signature) {
        this.extension = extension;
        this.mediaType = mediaType;
        this.acceptedMediaTypes = acceptedMediaTypes;
        this.signature = signature;
    }

    /** The file extension, lowercase and without the dot. */
    public String extension() {
        return extension;
    }

    /** The canonical media type: the one stored and the one served. */
    public String mediaType() {
        return mediaType;
    }

    /** Every media type a client may declare for this type, including {@link #mediaType()}. */
    public Set<String> acceptedMediaTypes() {
        return acceptedMediaTypes;
    }

    /** The type whose canonical media type this is. */
    public static Optional<SourceType> forMediaType(String canonicalMediaType) {
        return Arrays.stream(values()).filter(type -> type.mediaType.equals(canonicalMediaType)).findFirst();
    }

    /**
     * Recognises an upload from its file name and the media type the client declared.
     *
     * @param declaredMediaType the request part's {@code Content-Type}, possibly {@code null}, possibly with
     *                          parameters such as {@code charset}
     * @throws UnsupportedFileTypeException when the extension is not supported, or the declared media type
     *                                      contradicts it
     */
    public static SourceType resolve(SourceFilename filename, String declaredMediaType) {
        String extension = filename.extension().orElse(null);
        SourceType type = Arrays.stream(values())
                .filter(candidate -> candidate.extension.equals(extension))
                .findFirst()
                .orElseThrow(() -> new UnsupportedFileTypeException((extension == null
                        ? "The file has no extension, so its type cannot be recognised. "
                        : "Files of type ." + extension + " are not supported. ") + supportedTypesSentence()));

        String declared = normalizeMediaType(declaredMediaType);
        if (declared != null && !declared.equals(GENERIC_MEDIA_TYPE) && !type.acceptedMediaTypes.contains(declared)) {
            throw new UnsupportedFileTypeException("The file is named ." + type.extension + " but was sent as "
                    + declared + ", which is not a " + type.name() + " media type. " + supportedTypesSentence());
        }
        return type;
    }

    /**
     * Whether the first bytes of a file look like this type. {@code head} is at most
     * {@link #SIGNATURE_WINDOW_BYTES} long, and shorter for a small file.
     *
     * <p>A cheap sanity check, not a parser: PDF must start with {@code %PDF-}; DOCX and XLSX, being Office Open
     * XML, must start with a ZIP local file header; CSV and TXT must not contain a NUL byte, which no text
     * encoding this product accepts would produce. Whether the file then parses is the ingestion step's
     * question, and it answers with {@code FAILED}.
     */
    public boolean acceptsLeadingBytes(byte[] head) {
        return signature.matches(head);
    }

    /** "Supported types: PDF (.pdf), DOCX (.docx), ...". Shared by every rejection so they read the same. */
    public static String supportedTypesSentence() {
        return "Supported types: " + Arrays.stream(values())
                .map(type -> type.name() + " (." + type.extension + ")")
                .collect(Collectors.joining(", ")) + ".";
    }

    /** Lowercase, without parameters, or null when blank. */
    static String normalizeMediaType(String mediaType) {
        if (mediaType == null) {
            return null;
        }
        int parameters = mediaType.indexOf(';');
        String bare = (parameters >= 0 ? mediaType.substring(0, parameters) : mediaType)
                .strip().toLowerCase(Locale.ROOT);
        return bare.isEmpty() ? null : bare;
    }

    private enum Signature {
        PDF {
            @Override
            boolean matches(byte[] head) {
                return startsWith(head, "%PDF-".getBytes(StandardCharsets.US_ASCII));
            }
        },
        ZIP {
            @Override
            boolean matches(byte[] head) {
                return startsWith(head, new byte[]{'P', 'K', 3, 4});
            }
        },
        TEXT {
            @Override
            boolean matches(byte[] head) {
                for (byte value : head) {
                    if (value == 0) {
                        return false;
                    }
                }
                return true;
            }
        };

        abstract boolean matches(byte[] head);

        private static boolean startsWith(byte[] head, byte[] prefix) {
            return head.length >= prefix.length
                    && Arrays.equals(Arrays.copyOf(head, prefix.length), prefix);
        }
    }

}

package dev.researchhub.shared.validation;

/**
 * Whitespace normalization for user-entered identifiers and names.
 *
 * <p>Apply {@link #trim(String)} in a record compact constructor on an API request DTO so
 * the trimmed value is what Bean Validation, and the rest of the application, sees:
 *
 * <pre>{@code
 * public record CreateWorkspaceRequest(
 *         @NotBlank @Size(max = FieldLengths.NAME_MAX) String name
 * ) {
 *     public CreateWorkspaceRequest {
 *         name = Normalize.trim(name);
 *     }
 * }
 * }</pre>
 *
 * <p>Because the trim runs before {@code @NotBlank} is checked, a whitespace-only value
 * becomes an empty string and is rejected as blank, instead of being silently accepted as
 * invisible content.
 */
public final class Normalize {

    public static String trim(String value) {
        return value == null ? null : value.strip();
    }

    private Normalize() {
    }

}

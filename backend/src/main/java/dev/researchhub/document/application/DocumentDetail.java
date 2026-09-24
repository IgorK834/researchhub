package dev.researchhub.document.application;

/**
 * One document, including its content.
 *
 * <p>The content travels as the JSON text that is stored, not as a parsed tree: the backend does not interpret
 * it, so {@code document.api} embeds this string in the response as raw JSON and nothing in between has to
 * parse and re-serialize it.
 *
 * <p>Composed of a {@link DocumentSummary} rather than repeating its fields, so the list view and the detail
 * view cannot drift apart — adding a field to a summary adds it here too, by construction.
 */
public record DocumentDetail(DocumentSummary summary, String content) {
}

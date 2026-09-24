package dev.researchhub.document.application;

/**
 * One snapshot with its content, as the stored JSON text. See {@link DocumentDetail} for why the text is not
 * parsed here.
 */
public record DocumentVersionDetail(DocumentVersionSummary summary, String contentFormat, String content) {
}

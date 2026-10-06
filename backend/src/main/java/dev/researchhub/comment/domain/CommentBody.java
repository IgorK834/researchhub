package dev.researchhub.comment.domain;

/** Plain text; rendering never interprets HTML or mentions. */
public record CommentBody(String value) {
    public CommentBody {
        if (value == null || value.isBlank() || value.length() > 4000) {
            throw new IllegalArgumentException("Comment must contain between 1 and 4000 characters");
        }
        value = value.strip();
    }
}

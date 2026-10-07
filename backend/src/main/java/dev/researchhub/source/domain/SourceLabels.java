package dev.researchhub.source.domain;

import java.util.List;
import java.util.Locale;

/** Flat workspace-local tags and collections; labels never become paths or source identifiers. */
public final class SourceLabels {
    private SourceLabels() {}

    public static List<String> normalize(List<String> values) {
        if (values == null || values.size() > 20) throw new IllegalArgumentException("Labels must be a list of at most 20 entries");
        return values.stream().map(value -> {
            String label = BibliographicMetadata.text(value, 80, "Label");
            if (label == null) throw new IllegalArgumentException("Labels must not be blank");
            return label.toLowerCase(Locale.ROOT);
        }).distinct().sorted().toList();
    }

    public static String displayName(String value) {
        String name = BibliographicMetadata.text(value, SourceFilename.MAX_LENGTH, "Display name");
        if (name == null) throw new IllegalArgumentException("Display name must not be blank");
        return name;
    }
}

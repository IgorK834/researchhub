package dev.researchhub.source.domain;

import java.net.URI;
import java.text.Normalizer;
import java.util.List;

/** Human-editable description of a workspace source, never evidence that a URL was fetched. */
public record BibliographicMetadata(String title, List<String> authors, Integer publicationYear,
                                    String doi, String venue, String url, String citationKey) {
    public static final BibliographicMetadata EMPTY = new BibliographicMetadata(null, List.of(), null, null, null, null, null);

    public BibliographicMetadata {
        title = text(title, 1000, "Title");
        venue = text(venue, 500, "Journal/conference");
        if (authors == null || authors.size() > 100) throw new IllegalArgumentException("Authors must be a list of at most 100 names");
        authors = authors.stream().map(author -> {
            String name = text(author, 200, "Author");
            if (name == null) throw new IllegalArgumentException("Author names must not be blank");
            return name;
        }).toList();
        if (publicationYear != null && (publicationYear < 1 || publicationYear > 9999))
            throw new IllegalArgumentException("Publication year must be between 1 and 9999");
        doi = text(doi, 300, "DOI");
        if (doi != null) {
            doi = doi.replaceFirst("(?i)^(https?://(dx\\.)?doi\\.org/|doi:\\s*)", "");
            // DOI equivalence folds Basic Latin only; preserve non-ASCII suffix characters.
            var canonical = new StringBuilder(doi.length());
            for (int index = 0; index < doi.length(); index++) {
                char character = doi.charAt(index);
                canonical.append(character >= 'A' && character <= 'Z' ? (char) (character + 32) : character);
            }
            doi = canonical.toString();
            if (!doi.matches("10\\.\\d{4,9}/[^\\s]+")) throw new IllegalArgumentException("DOI must have the form 10.xxxx/suffix");
        }
        url = text(url, 2000, "URL");
        if (url != null) {
            URI parsed = URI.create(url);
            if (!("https".equalsIgnoreCase(parsed.getScheme()) || "http".equalsIgnoreCase(parsed.getScheme()))
                    || parsed.getHost() == null || parsed.getUserInfo() != null)
                throw new IllegalArgumentException("URL must be an absolute HTTP(S) address without credentials");
            url = parsed.normalize().toASCIIString();
            if (url.length() > 2000) throw new IllegalArgumentException("URL must be at most 2000 characters");
        }
        citationKey = text(citationKey, 100, "Citation key");
        if (citationKey != null && !citationKey.matches("[A-Za-z0-9][A-Za-z0-9_.:-]*"))
            throw new IllegalArgumentException("Citation key may contain letters, digits, dots, underscores, colons and hyphens");
    }

    static String text(String value, int max, String field) {
        if (value == null) return null;
        value = Normalizer.normalize(value.strip(), Normalizer.Form.NFC);
        if (value.isEmpty()) return null;
        if (value.length() > max || value.codePoints().anyMatch(c -> Character.isISOControl(c) || Character.getType(c) == Character.FORMAT))
            throw new IllegalArgumentException(field + " must be at most " + max + " characters without control characters");
        return value;
    }
}

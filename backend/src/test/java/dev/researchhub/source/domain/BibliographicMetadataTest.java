package dev.researchhub.source.domain;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class BibliographicMetadataTest {
    private BibliographicMetadata metadata(String doi, String url) {
        return new BibliographicMetadata("  Cafe\u0301 study  ", List.of(" Ada ", "Smith, J."), 2025,
                doi, " Nature ", url, "Ada_2025");
    }

    @Test void normalizesFieldsWithoutReorderingAuthors() {
        var result = metadata("https://doi.org/10.1234/ABC", "https://example.org/a/../paper");
        assertEquals("Café study", result.title());
        assertEquals(List.of("Ada", "Smith, J."), result.authors());
        assertEquals("10.1234/abc", result.doi());
        assertEquals("https://example.org/paper", result.url());
        assertEquals("Nature", result.venue());
        assertEquals("10.1234/Äabc", metadata("10.1234/ÄABC", null).doi());
        assertEquals(BibliographicMetadata.EMPTY, new BibliographicMetadata(" ", List.of(), null, "", "", "", ""));
        assertEquals("10.1234/abc", metadata("DOI: 10.1234/ABC", null).doi());
        assertEquals("10.1234/abc", metadata("http://dx.doi.org/10.1234/ABC", null).doi());
    }

    @ParameterizedTest @ValueSource(strings = {"abc", "10.12/x", "10.1234/with space", "https://evil.org/10.1234/x"})
    void rejectsInvalidDois(String doi) { assertThrows(IllegalArgumentException.class, () -> metadata(doi, null)); }

    @ParameterizedTest @ValueSource(strings = {"javascript:alert(1)", "file:///tmp/x", "/relative", "https://user:pass@example.org/paper", "https://", "http://example.org/\nheader"})
    void rejectsUnsafeOrInvalidUrls(String url) { assertThrows(IllegalArgumentException.class, () -> metadata(null, url)); }

    @Test void enforcesFieldLimitsAndAuthorShape() {
        assertThrows(IllegalArgumentException.class, () -> new BibliographicMetadata("x".repeat(1001), List.of(), null, null, null, null, null));
        assertThrows(IllegalArgumentException.class, () -> new BibliographicMetadata(null, null, null, null, null, null, null));
        assertThrows(IllegalArgumentException.class, () -> new BibliographicMetadata(null, List.of(" "), null, null, null, null, null));
        assertThrows(IllegalArgumentException.class, () -> new BibliographicMetadata(null, java.util.Collections.nCopies(101, "Ada"), null, null, null, null, null));
        assertThrows(IllegalArgumentException.class, () -> new BibliographicMetadata(null, List.of("a".repeat(201)), null, null, null, null, null));
        for (int year : List.of(0, 10000)) assertThrows(IllegalArgumentException.class, () -> new BibliographicMetadata(null, List.of(), year, null, null, null, null));
        for (String key : List.of("with space", "{latex}", "a".repeat(101))) assertThrows(IllegalArgumentException.class, () -> new BibliographicMetadata(null, List.of(), null, null, null, null, key));
        assertThrows(IllegalArgumentException.class, () -> metadata(null, "https://example.org/" + "é".repeat(700)));
        assertThrows(IllegalArgumentException.class, () -> new BibliographicMetadata("hidden\u202etext", List.of(), null, null, null, null, null));
    }

    @Test void normalizesLabelsAndRejectsUnboundedOrUnsafeOrganization() {
        assertEquals(List.of("papers", "review"), SourceLabels.normalize(List.of(" Review ", "PAPERS", "review")));
        assertEquals("Paper name", SourceLabels.displayName(" Paper name "));
        assertThrows(IllegalArgumentException.class, () -> SourceLabels.normalize(null));
        assertThrows(IllegalArgumentException.class, () -> SourceLabels.normalize(java.util.Collections.nCopies(21, "a")));
        assertThrows(IllegalArgumentException.class, () -> SourceLabels.normalize(List.of("")));
        assertThrows(IllegalArgumentException.class, () -> SourceLabels.normalize(List.of("a".repeat(81))));
        assertThrows(IllegalArgumentException.class, () -> SourceLabels.displayName("na\rme"));
        assertThrows(IllegalArgumentException.class, () -> SourceLabels.displayName(" "));
    }
}

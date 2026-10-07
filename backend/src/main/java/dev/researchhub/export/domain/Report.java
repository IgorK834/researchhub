package dev.researchhub.export.domain;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import java.time.Instant;
import java.util.*;

/** Versioned, browser-independent snapshot. Renderers consume only this contract, never editor JSON. */
public record Report(String schemaVersion, UUID workspaceId, UUID documentId, long revision, String title,
                     Instant capturedAt, List<Block> blocks, List<BibliographyEntry> bibliography,
                     List<Origin> origins, List<String> warnings) {
    public Report {
        if (!"1.0".equals(schemaVersion) || revision < 1) throw new IllegalArgumentException("Invalid report version");
        blocks=List.copyOf(blocks); bibliography=List.copyOf(bibliography); origins=List.copyOf(origins); warnings=List.copyOf(warnings);
    }
    public enum Style { BOLD, ITALIC, UNDERLINE, STRIKE, CODE }
    @JsonTypeInfo(use=JsonTypeInfo.Id.NAME, property="kind")
    @JsonSubTypes({@JsonSubTypes.Type(value=Text.class,name="text"), @JsonSubTypes.Type(value=Citation.class,name="citation")})
    public sealed interface Inline permits Text, Citation {}
    public record Text(String text, Set<Style> styles) implements Inline {
        public Text { styles=Set.copyOf(styles); }
    }
    /** Every occurrence keeps its immutable location, even when several citations share one bibliography label. */
    public record Citation(int number, SourceReference reference) implements Inline {}
    public record Span(String unitId, long characterStart, long characterEnd) {}
    public record SourceReference(UUID sourceId, UUID sourceVersionId, int versionNumber, String title, String sha256,
                                  String processingVersion, String chunkId, String citedContentHash, Integer pageStart, Integer pageEnd,
                                  String sectionTitle, List<Span> spans) {
        public SourceReference { spans=List.copyOf(spans); }
    }
    public record BibliographyEntry(int number, SourceReference source) {}
    /** Trusted operation metadata is preserved as JSON text, independently of the editor's attributes. */
    public record Origin(UUID blockId, UUID operationId, String category, UUID actorUserId, String actorName,
                         UUID sourceOperationId, long documentRevision, Instant createdAt, String metadataJson) {}
    public record AnalysisProvenance(UUID analysisId, UUID executionId, String outputId, String codeSha256,
                                     List<SourceReference> inputs) {
        public AnalysisProvenance { inputs=List.copyOf(inputs); }
    }
    @JsonTypeInfo(use=JsonTypeInfo.Id.NAME, property="kind")
    @JsonSubTypes({
        @JsonSubTypes.Type(value=Paragraph.class,name="paragraph"), @JsonSubTypes.Type(value=Heading.class,name="heading"),
        @JsonSubTypes.Type(value=ListBlock.class,name="list"), @JsonSubTypes.Type(value=Table.class,name="table"),
        @JsonSubTypes.Type(value=Image.class,name="image"), @JsonSubTypes.Type(value=Container.class,name="container"),
        @JsonSubTypes.Type(value=Code.class,name="code"), @JsonSubTypes.Type(value=Rule.class,name="rule"),
        @JsonSubTypes.Type(value=Equation.class,name="equation")})
    public sealed interface Block permits Paragraph, Heading, ListBlock, Table, Image, Container, Code, Rule, Equation {}
    public record Paragraph(List<Inline> content, boolean caption) implements Block {
        public Paragraph { content=List.copyOf(content); }
    }
    public record Heading(int level, List<Inline> content) implements Block {
        public Heading { if (level<1 || level>6) throw new IllegalArgumentException("Invalid heading"); content=List.copyOf(content); }
    }
    public record ListBlock(boolean ordered, int start, List<List<Block>> items) implements Block {
        public ListBlock { items=items.stream().map(List::copyOf).toList(); }
    }
    public record Cell(boolean header, int colspan, int rowspan, List<Block> blocks) {
        public Cell { blocks=List.copyOf(blocks); }
    }
    public record Table(List<List<Cell>> rows, String caption, AnalysisProvenance provenance) implements Block {
        public Table { rows=rows.stream().map(List::copyOf).toList(); }
    }
    /** Embedded PNG only. Assets are resolved and verified before snapshot storage; no remote URLs. */
    public record Image(String pngBase64, int width, int height, String alt, String caption,
                        AnalysisProvenance provenance) implements Block {}
    public record Container(List<Block> blocks, boolean quote) implements Block {
        public Container { blocks=List.copyOf(blocks); }
    }
    public record Code(String text) implements Block {}
    public record Rule() implements Block {}
    /** Reserved for future mathematical typesetting. MVP renders the source notation visibly. */
    public record Equation(String notation, String source) implements Block {}
}

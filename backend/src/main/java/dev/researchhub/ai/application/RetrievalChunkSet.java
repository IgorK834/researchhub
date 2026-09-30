package dev.researchhub.ai.application;

import dev.researchhub.processing.application.SourceExtraction;
import java.util.*;
import static dev.researchhub.ai.application.RetrievalIdentity.*;

/** Worker chunking output; Spring verifies grounding and versions, but does not perform AI chunking. */
public record RetrievalChunkSet(String schemaVersion, UUID sourceId, UUID workspaceId, UUID sourceVersionId,
                                String ingestionVersion, String parserVersion, String sourceContentHash,
                                String extractionContentHash, String processingVersion, ChunkingConfig config,
                                List<RetrievalChunk> chunks) {
    public RetrievalChunkSet withChunks(List<RetrievalChunk> value) {
        return new RetrievalChunkSet(schemaVersion, sourceId, workspaceId, sourceVersionId, ingestionVersion,
                parserVersion, sourceContentHash, extractionContentHash, processingVersion, config, value);
    }
    public void validate(UUID expectedWorkspace, UUID expectedSource, SourceExtraction extraction) {
        require("1.0".equals(schemaVersion) && expectedWorkspace.equals(workspaceId) && expectedSource.equals(sourceId));
        require(sourceVersionId == null && config != null && chunks != null && chunks.size() <= 10000);
        config.validate();
        require(extraction.processingVersion().equals(ingestionVersion) && extraction.parserVersion().equals(parserVersion));
        require(extraction.extractionMetadata().contentSha256().equals(sourceContentHash));
        require(hash(extraction.chunks().stream().map(SourceExtraction.ExtractedChunk::text).collect(java.util.stream.Collectors.joining())).equals(extractionContentHash));
        String version = "retrieval-1:" + digest(ingestionVersion, parserVersion, sourceContentHash, extractionContentHash,
                config.version(), config.maxCharacters(), config.overlapCharacters(), config.minCharacters());
        require(version.equals(processingVersion));
        var units = new HashMap<String, SourceExtraction.ExtractedChunk>();
        extraction.chunks().forEach(unit -> units.put(unit.chunkId(), unit));
        var sections = new HashMap<String, SourceExtraction.SectionStructure>();
        extraction.structure().sections().forEach(section -> sections.put(section.sectionId(), section));
        var covered = new HashMap<String, List<SourceSpan>>();
        var ids = new HashSet<String>();
        long previousStart = -1;
        for (int index = 0; index < chunks.size(); index++) {
            var chunk = chunks.get(index);
            require(chunk != null && expectedWorkspace.equals(chunk.workspaceId()) && expectedSource.equals(chunk.sourceId())
                    && chunk.sourceVersionId() == null && chunk.chunkIndex() == index && version.equals(chunk.processingVersion()));
            require(chunk.content() != null && !blank(chunk.content())
                    && chunk.content().codePointCount(0, chunk.content().length()) <= config.maxCharacters());
            require(chunk.spans() != null && !chunk.spans().isEmpty() && chunk.spans().size() <= 10000);
            require(chunk.spans().getFirst() != null && chunk.spans().getFirst().characterStart() >= previousStart);
            previousStart = chunk.spans().getFirst().characterStart();
            require(content(chunk.spans(), units).equals(chunk.content()));
            require(hash(chunk.content()).equals(chunk.contentHash()) && chunkId(chunk).equals(chunk.chunkId()) && ids.add(chunk.chunkId()));
            var referenced = chunk.spans().stream().map(span -> units.get(span.unitId())).toList();
            var last = referenced.getLast();
            var section = sections.get(last.sectionId());
            require(Objects.equals(section == null ? null : section.heading(), chunk.sectionTitle()));
            Integer page = last.pageNumber();
            String sheet = last.location() == null ? null : last.location().sheetName();
            for (var unit : referenced) {
                require(Objects.equals(page, unit.pageNumber()));
                require(Objects.equals(sheet, unit.location() == null ? null : unit.location().sheetName()));
                require(Objects.equals(last.sectionId(), unit.sectionId()) || (unit.location() != null
                        && "HEADING".equals(unit.location().kind()) && ancestor(unit.sectionId(), last.sectionId(), sections)));
            }
            require(Objects.equals(page, chunk.pageStart()) && Objects.equals(page, chunk.pageEnd()));
            chunk.spans().forEach(span -> covered.computeIfAbsent(span.unitId(), _key -> new ArrayList<>()).add(span));
        }
        for (var unit : extraction.chunks()) {
            var spans = covered.getOrDefault(unit.chunkId(), List.of()).stream().sorted(Comparator.comparingLong(SourceSpan::characterStart)).toList();
            long end = unit.characterStart();
            for (var span : spans) {
                if (span.characterStart() > end) require(blank(slice(unit, end, span.characterStart())));
                end = Math.max(end, span.characterEnd());
            }
            require(blank(slice(unit, end, unit.characterEnd())));
        }
    }
    public static String content(List<SourceSpan> spans, Map<String, SourceExtraction.ExtractedChunk> units) {
        var pieces = new ArrayList<String>();
        long end = -1;
        for (var span : spans) {
            require(span != null && span.unitId() != null && units.containsKey(span.unitId()));
            var unit = units.get(span.unitId());
            require(span.characterStart() >= unit.characterStart() && span.characterEnd() <= unit.characterEnd()
                    && span.characterEnd() > span.characterStart() && span.characterStart() >= end);
            pieces.add(slice(unit, span.characterStart(), span.characterEnd()));
            end = span.characterEnd();
        }
        return String.join("\n\n", pieces);
    }
    private static String slice(SourceExtraction.ExtractedChunk unit, long start, long end) {
        return unit.text().substring(unit.text().offsetByCodePoints(0, Math.toIntExact(start - unit.characterStart())),
                unit.text().offsetByCodePoints(0, Math.toIntExact(end - unit.characterStart())));
    }
    private static boolean ancestor(String ancestor, String leaf, Map<String, SourceExtraction.SectionStructure> sections) {
        while (leaf != null && sections.containsKey(leaf)) {
            if (leaf.equals(ancestor)) return true;
            leaf = sections.get(leaf).parentSectionId();
        }
        return false;
    }
    /** Match Python str.isspace()/strip(), including non-breaking spaces and NEXT LINE. */
    private static boolean blank(String text) {
        return text.codePoints().allMatch(codePoint -> Character.isWhitespace(codePoint)
                || Character.isSpaceChar(codePoint) || codePoint == 0x85);
    }
    private static void require(boolean condition) {
        if (!condition) throw new IllegalArgumentException("Invalid retrieval chunk contract");
    }
}

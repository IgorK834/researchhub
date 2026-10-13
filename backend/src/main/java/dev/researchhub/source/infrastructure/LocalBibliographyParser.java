package dev.researchhub.source.infrastructure;

import dev.researchhub.source.application.BibliographyImportContracts.*;
import dev.researchhub.source.application.BibliographyParser;
import dev.researchhub.source.application.SourceBibliography;
import dev.researchhub.source.domain.SourceLabels;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Bounded text parsers. Values are data only: no macro execution, filesystem reads, or network access. */
@Component
public final class LocalBibliographyParser implements BibliographyParser {
    private static final Set<String> ATTACHMENTS = Set.of("file", "files", "attachment", "attachments", "pdf");
    private static final Pattern YEAR = Pattern.compile("(?<!\\d)(\\d{4})(?!\\d)");
    private static final Pattern RIS_TAG = Pattern.compile("^([A-Z0-9]{2}) {0,2}- ?(.*)$");
    private final ObjectMapper json;

    public LocalBibliographyParser(ObjectMapper json) {
        this.json = json;
    }

    @Override
    public ParsedBatch parse(Format format, byte[] utf8File) {
        String text = decode(utf8File);
        return switch (format) {
            case BIBTEX -> bibtex(text);
            case RIS -> ris(text);
            case CSL_JSON -> csl(text);
        };
    }

    private static String decode(byte[] bytes) {
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
                    .replaceFirst("^\\uFEFF", "");
        } catch (java.nio.charset.CharacterCodingException invalid) {
            throw new IllegalArgumentException("Bibliography files must be valid UTF-8");
        }
    }

    private ParsedBatch bibtex(String text) {
        var records = new ArrayList<ParsedRecord>();
        var errors = new ArrayList<ParseError>();
        int cursor = 0;
        int number = 0;
        while (true) {
            int start = text.indexOf('@', cursor);
            if (start < 0) break;
            number++;
            requireRecordLimit(number);
            int line = line(text, start);
            try {
                int typeEnd = start + 1;
                while (typeEnd < text.length() && Character.isLetter(text.charAt(typeEnd))) typeEnd++;
                String rawType = text.substring(start + 1, typeEnd).toLowerCase(Locale.ROOT);
                int open = skipSpace(text, typeEnd);
                if (open >= text.length() || (text.charAt(open) != '{' && text.charAt(open) != '('))
                    throw new ParseFailure("Expected '{' after the BibTeX type", Math.max(open, start + 1));
                char close = text.charAt(open) == '{' ? '}' : ')';
                int end = matching(text, open, text.charAt(open), close);
                cursor = end + 1;
                if (Set.of("comment", "preamble", "string").contains(rawType)) {
                    errors.add(new ParseError(number, "line " + line,
                            "BibTeX directives are not publication records and are not imported"));
                    continue;
                }
                String itemType = bibType(rawType);
                String body = text.substring(open + 1, end);
                int comma = topLevelComma(body, 0);
                if (comma < 0) throw new ParseFailure("BibTeX record has no citation key separator", open);
                String citationKey = body.substring(0, comma).strip();
                var fields = bibFields(body.substring(comma + 1));
                int ignored = (int) fields.keySet().stream().filter(ATTACHMENTS::contains).count();
                ATTACHMENTS.forEach(fields::remove);
                var bibliography = validated(new SourceBibliography(value(fields, "title"),
                        authors(rawValue(fields, "author")), year(value(fields, "year", "date")),
                        value(fields, "doi"), value(fields, "journal", "booktitle", "publisher"),
                        value(fields, "url"), citationKey));
                records.add(new ParsedRecord(number, "line " + line, itemType, bibliography,
                        labels(value(fields, "keywords", "keyword")), labels(value(fields, "collection", "collections")),
                        ignored, ignored == 0 ? List.of() : List.of("Attachment paths were ignored")));
            } catch (RuntimeException invalid) {
                errors.add(new ParseError(number, "line " + line, safe(invalid)));
                cursor = Math.max(cursor, start + 1);
            }
        }
        if (number == 0 && !text.isBlank()) errors.add(new ParseError(1, "line 1", "No BibTeX records were found"));
        return new ParsedBatch(records, errors);
    }

    private static Map<String, String> bibFields(String body) {
        var result = new LinkedHashMap<String, String>();
        int cursor = 0;
        while (cursor < body.length()) {
            cursor = skipSeparators(body, cursor);
            if (cursor >= body.length()) break;
            int nameStart = cursor;
            while (cursor < body.length() && (Character.isLetterOrDigit(body.charAt(cursor)) || body.charAt(cursor) == '-')) cursor++;
            if (nameStart == cursor) throw new IllegalArgumentException("Invalid BibTeX field name");
            String name = body.substring(nameStart, cursor).toLowerCase(Locale.ROOT);
            cursor = skipSpace(body, cursor);
            if (cursor >= body.length() || body.charAt(cursor) != '=') throw new IllegalArgumentException("BibTeX field needs '='");
            cursor = skipSpace(body, cursor + 1);
            var parsed = bibValue(body, cursor);
            result.put(name, parsed.value());
            cursor = parsed.next();
        }
        return result;
    }

    private record Value(String value, int next) {}

    private static Value bibValue(String body, int cursor) {
        if (cursor >= body.length()) throw new IllegalArgumentException("Missing BibTeX field value");
        char first = body.charAt(cursor);
        if (first == '{') {
            int end = matching(body, cursor, '{', '}');
            return new Value(body.substring(cursor + 1, end).strip(), end + 1);
        }
        if (first == '"') {
            int end = cursor + 1;
            int braces = 0;
            boolean escaped = false;
            for (; end < body.length(); end++) {
                char character = body.charAt(end);
                if (escaped) { escaped = false; continue; }
                if (character == '\\') { escaped = true; continue; }
                if (character == '{') braces++;
                else if (character == '}') braces--;
                else if (character == '"' && braces == 0) break;
            }
            if (end >= body.length()) throw new IllegalArgumentException("Unclosed quoted BibTeX value");
            return new Value(body.substring(cursor + 1, end).strip(), end + 1);
        }
        int end = cursor;
        while (end < body.length() && body.charAt(end) != ',') end++;
        return new Value(body.substring(cursor, end).strip(), end);
    }

    private static int matching(String text, int start, char open, char close) {
        int depth = 0;
        boolean quoted = false;
        boolean escaped = false;
        for (int index = start; index < text.length(); index++) {
            char character = text.charAt(index);
            if (escaped) { escaped = false; continue; }
            if (character == '\\') { escaped = true; continue; }
            if (open == '(' && character == '"') quoted = !quoted;
            if (!quoted && character == open) depth++;
            else if (!quoted && character == close && --depth == 0) return index;
        }
        throw new ParseFailure("Unclosed BibTeX record", start);
    }

    private static int topLevelComma(String text, int start) {
        int depth = 0;
        boolean quoted = false;
        boolean escaped = false;
        for (int index = start; index < text.length(); index++) {
            char character = text.charAt(index);
            if (escaped) { escaped = false; continue; }
            if (character == '\\') { escaped = true; continue; }
            if (character == '"') quoted = !quoted;
            if (!quoted && character == '{') depth++;
            else if (!quoted && character == '}') depth--;
            else if (!quoted && depth == 0 && character == ',') return index;
        }
        return -1;
    }

    private static List<String> authors(String value) {
        if (value == null) return List.of();
        var authors = new ArrayList<String>();
        int start = 0;
        int braces = 0;
        for (int index = 0; index <= value.length(); index++) {
            if (index < value.length()) {
                if (value.charAt(index) == '{') braces++;
                else if (value.charAt(index) == '}') braces--;
            }
            boolean separator = braces == 0 && index + 5 <= value.length()
                    && value.regionMatches(true, index, " and ", 0, 5);
            if (separator || index == value.length()) {
                String author = plainBib(value.substring(start, index));
                if (!author.isBlank()) authors.add(author);
                if (separator) { index += 4; start = index + 1; }
            }
        }
        return authors;
    }

    private ParsedBatch ris(String text) {
        var records = new ArrayList<ParsedRecord>();
        var errors = new ArrayList<ParseError>();
        Map<String, List<String>> fields = null;
        String currentTag = null;
        int startLine = 1;
        int number = 0;
        String[] lines = text.split("\\R", -1);
        for (int index = 0; index < lines.length; index++) {
            String line = lines[index];
            var tagged = RIS_TAG.matcher(line);
            if (tagged.matches()) {
                String tag = tagged.group(1);
                String value = tagged.group(2).strip();
                if ("TY".equals(tag)) {
                    if (fields != null) {
                        number++;
                        requireRecordLimit(number);
                        errors.add(new ParseError(number, "line " + startLine, "RIS record is missing ER"));
                    }
                    fields = new LinkedHashMap<>();
                    startLine = index + 1;
                }
                if (fields == null) continue;
                if ("ER".equals(tag)) {
                    number++;
                    requireRecordLimit(number);
                    addRis(records, errors, number, startLine, fields);
                    fields = null;
                    currentTag = null;
                } else {
                    fields.computeIfAbsent(tag, ignored -> new ArrayList<>()).add(value);
                    currentTag = tag;
                }
            } else if (fields != null && currentTag != null && !line.isBlank()) {
                var values = fields.get(currentTag);
                values.set(values.size() - 1, values.getLast() + " " + line.strip());
            }
        }
        if (fields != null) {
            number++;
            requireRecordLimit(number);
            errors.add(new ParseError(number, "line " + startLine, "RIS record is missing ER"));
        }
        if (number == 0 && !text.isBlank()) errors.add(new ParseError(1, "line 1", "No RIS records were found"));
        return new ParsedBatch(records, errors);
    }

    private static void addRis(List<ParsedRecord> records, List<ParseError> errors, int number, int line,
                               Map<String, List<String>> fields) {
        try {
            String itemType = risType(first(fields, "TY"));
            int ignored = size(fields, "L1") + size(fields, "L2") + size(fields, "L4");
            var bibliography = validated(new SourceBibliography(first(fields, "TI", "T1", "CT"),
                    many(fields, "AU", "A1"), year(first(fields, "PY", "Y1", "DA")), first(fields, "DO"),
                    first(fields, "JO", "JF", "T2", "PB"), first(fields, "UR"), first(fields, "ID")));
            records.add(new ParsedRecord(number, "line " + line, itemType, bibliography,
                    normalizeLabels(fields.getOrDefault("KW", List.of())), normalizeLabels(fields.getOrDefault("C1", List.of())),
                    ignored, ignored == 0 ? List.of() : List.of("Attachment paths and links were ignored")));
        } catch (RuntimeException invalid) {
            errors.add(new ParseError(number, "line " + line, safe(invalid)));
        }
    }

    private ParsedBatch csl(String text) {
        var records = new ArrayList<ParsedRecord>();
        var errors = new ArrayList<ParseError>();
        JsonNode root;
        try { root = json.rebuild().enable(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build().readTree(text); }
        catch (RuntimeException invalid) { return new ParsedBatch(List.of(), List.of(new ParseError(1, "JSON root", "Invalid CSL-JSON"))); }
        JsonNode items = root.isArray() ? root : root.path("items");
        if (!items.isArray()) return new ParsedBatch(List.of(), List.of(new ParseError(1, "JSON root", "CSL-JSON must be an array or an object with an items array")));
        int number = 0;
        for (JsonNode item : items) {
            number++;
            requireRecordLimit(number);
            try {
                if(!item.isObject())throw new IllegalArgumentException("A CSL record must be an object");
                String type = cslType(text(item, "type"));
                var bibliography = validated(new dev.researchhub.source.application.BibliographyCslMapper().fromCsl(item));
                var tags = new ArrayList<String>();
                addJsonLabels(tags, item.get("categories"));
                addJsonLabels(tags, item.get("keyword"));
                var collections = new ArrayList<String>();
                addJsonLabels(collections, item.get("collections"));
                addJsonLabels(collections, item.get("collection"));
                int ignored = countPresent(item, "attachments", "attachment", "file", "files");
                var warnings=new ArrayList<String>();
                if(ignored>0)warnings.add("Attachment paths and URLs were ignored");
                if(item.has("note")||item.has("abstract"))warnings.add("Notes and abstracts are not imported");
                records.add(new ParsedRecord(number, "item " + number, type, bibliography,
                        normalizeLabels(tags), normalizeLabels(collections), ignored,
                        warnings));
            } catch (RuntimeException invalid) {
                errors.add(new ParseError(number, "item " + number, safe(invalid)));
            }
        }
        return new ParsedBatch(records, errors);
    }

    private static String bibType(String value) {
        return switch (value) {
            case "article" -> "article-journal";
            case "book", "booklet" -> "book";
            case "inbook", "incollection" -> "chapter";
            case "inproceedings", "conference" -> "paper-conference";
            case "phdthesis", "mastersthesis" -> "thesis";
            case "techreport" -> "report";
            case "online", "webpage" -> "webpage";
            case "misc", "unpublished", "manual" -> "document";
            default -> throw new IllegalArgumentException("Unsupported BibTeX type: " + value);
        };
    }

    private static String risType(String value) {
        if (value == null) throw new IllegalArgumentException("RIS record is missing TY");
        return switch (value.toUpperCase(Locale.ROOT)) {
            case "JOUR", "JFULL", "EJOUR" -> "article-journal";
            case "BOOK" -> "book";
            case "CHAP" -> "chapter";
            case "CONF", "CPAPER" -> "paper-conference";
            case "THES" -> "thesis";
            case "RPRT" -> "report";
            case "ELEC", "WEB" -> "webpage";
            case "GEN", "UNPB" -> "document";
            default -> throw new IllegalArgumentException("Unsupported RIS type: " + value);
        };
    }

    private static String cslType(String value) {
        if (value == null || !Set.of("article-journal", "article", "book", "chapter", "paper-conference",
                "thesis", "report", "webpage", "document", "dataset").contains(value))
            throw new IllegalArgumentException("Unsupported CSL-JSON type: " + value);
        return value;
    }

    private static SourceBibliography validated(SourceBibliography bibliography) {
        var normalized = SourceBibliography.from(bibliography.toDomain());
        if (normalized.title() == null && normalized.doi() == null && normalized.citationKey() == null)
            throw new IllegalArgumentException("A bibliography record needs a title, DOI, or citation key");
        return normalized;
    }

    private static String plainBib(String value) {
        return value.strip().replace("\\{", "\u0001").replace("\\}", "\u0002")
                .replace("{", "").replace("}", "").replace("\u0001", "{").replace("\u0002", "}").strip();
    }

    private static String value(Map<String, String> values, String... names) {
        for (String name : names) {
            String value = values.get(name);
            if (value != null && !value.isBlank()) return plainBib(value);
        }
        return null;
    }

    private static String rawValue(Map<String, String> values, String name) {
        String value = values.get(name);
        return value == null || value.isBlank() ? null : value;
    }

    private static String first(Map<String, List<String>> values, String... names) {
        for (String name : names) {
            var candidates = values.get(name);
            if (candidates != null && !candidates.isEmpty() && !candidates.getFirst().isBlank()) return candidates.getFirst();
        }
        return null;
    }

    private static List<String> many(Map<String, List<String>> values, String... names) {
        var result = new ArrayList<String>();
        for (String name : names) result.addAll(values.getOrDefault(name, List.of()));
        return result.stream().filter(value -> !value.isBlank()).toList();
    }

    private static Integer year(String... values) {
        for (String value : values) {
            if (value == null) continue;
            var match = YEAR.matcher(value);
            if (match.find()) return Integer.valueOf(match.group(1));
            if(value.matches("\\d{1,4}"))return Integer.valueOf(value);
            if(!value.equalsIgnoreCase("n.d."))throw new IllegalArgumentException("Publication date does not contain a supported year");
        }
        return null;
    }

    private static List<String> labels(String value) {
        return value == null ? List.of() : normalizeLabels(List.of(value));
    }

    private static List<String> normalizeLabels(List<String> values) {
        var split = values.stream().flatMap(value -> Pattern.compile("[,;]").splitAsStream(value))
                .map(String::strip).filter(value -> !value.isEmpty()).toList();
        return SourceLabels.normalize(split);
    }

    private static void addJsonLabels(List<String> target, JsonNode value) {
        if (value == null || value.isNull()) return;
        if (value.isArray()) {
            for (JsonNode item : value) if (item.isString()) target.add(item.asString());
        } else if (value.isString()) target.add(value.asString());
    }

    private static int countPresent(JsonNode item, String... names) {
        int count = 0;
        for (String name : names) if (item.has(name) && !item.path(name).isNull()) count++;
        return count;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isString() && !value.asString().isBlank() ? value.asString().strip() : null;
    }

    private static int size(Map<String, List<String>> values, String name) {
        return values.getOrDefault(name, List.of()).size();
    }

    private static int skipSpace(String text, int cursor) {
        while (cursor < text.length() && Character.isWhitespace(text.charAt(cursor))) cursor++;
        return cursor;
    }

    private static int skipSeparators(String text, int cursor) {
        while (cursor < text.length() && (Character.isWhitespace(text.charAt(cursor)) || text.charAt(cursor) == ',')) cursor++;
        return cursor;
    }

    private static int line(String text, int index) {
        int line = 1;
        for (int cursor = 0; cursor < index; cursor++) if (text.charAt(cursor) == '\n') line++;
        return line;
    }

    private static void requireRecordLimit(int number) {
        if (number > dev.researchhub.source.application.BibliographyImportService.MAX_RECORDS)
            throw new dev.researchhub.shared.error.PayloadTooLargeException("A bibliography import may contain at most 1000 records");
    }

    private static String safe(RuntimeException error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? "Invalid bibliography record" : message;
    }

    private static final class ParseFailure extends IllegalArgumentException {
        ParseFailure(String message, int ignoredOffset) { super(message); }
    }
}

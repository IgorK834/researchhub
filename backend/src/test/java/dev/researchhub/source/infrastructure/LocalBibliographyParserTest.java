package dev.researchhub.source.infrastructure;

import dev.researchhub.source.application.BibliographyImportContracts.Format;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class LocalBibliographyParserTest {
    private final LocalBibliographyParser parser = new LocalBibliographyParser(new ObjectMapper());

    @Test
    void bibtexMapsUnicodeAuthorsDoiDateTypeAndReportsEveryBadRecord() throws Exception {
        var parsed = parser.parse(Format.BIBTEX, fixture("generic.bib"));

        assertEquals(3, parsed.records().size());
        assertEquals(1, parsed.errors().size());
        var first = parsed.records().getFirst();
        assertEquals("article-journal", first.itemType());
        assertEquals("Zażółć gęślą jaźń: an {escaped} brace", first.bibliography().title());
        assertEquals(java.util.List.of("Kowalski, Jan", "Nowak, Anna"), first.bibliography().authors());
        assertEquals(2025, first.bibliography().publicationYear());
        assertEquals("10.5555/synthetic.1", first.bibliography().doi());
        assertEquals("Synthetic Research", first.bibliography().venue());
        assertEquals("kowalski2025", first.bibliography().citationKey());
        assertEquals(java.util.List.of("methods", "unicode"), first.tags());
        assertEquals(java.util.List.of("imported papers"), first.collections());
        assertEquals(1, first.ignoredAttachments());
        assertEquals(java.util.List.of("Synthetic Research Foundation"), parsed.records().get(1).bibliography().authors());
        assertNull(parsed.records().get(1).bibliography().publicationYear());
        assertTrue(parsed.errors().getFirst().message().contains("Unsupported BibTeX type"));
    }

    @Test
    void risMapsMendeleyFieldsAndNeverTreatsAttachmentsAsInput() throws Exception {
        var parsed = parser.parse(Format.RIS, fixture("mendeley-export.ris"));

        assertTrue(parsed.errors().isEmpty());
        assertEquals(2, parsed.records().size());
        var first = parsed.records().getFirst();
        assertEquals("article-journal", first.itemType());
        assertEquals("Café measurements in a synthetic cohort", first.bibliography().title());
        assertEquals(java.util.List.of("García, Lucía", "Example Consortium"), first.bibliography().authors());
        assertEquals(2024, first.bibliography().publicationYear());
        assertEquals("10.5555/mendeley.2", first.bibliography().doi());
        assertEquals("https://example.invalid/reference-only", first.bibliography().url());
        assertEquals(java.util.List.of("mendeley collection"), first.collections());
        assertEquals(1, first.ignoredAttachments());
        assertNull(parsed.records().get(1).bibliography().publicationYear());
    }

    @Test
    void cslJsonMapsZoteroLiteralAuthorsCollectionsAndPartialFields() throws Exception {
        var parsed = parser.parse(Format.CSL_JSON, fixture("zotero-export.json"));

        assertTrue(parsed.errors().isEmpty());
        assertEquals(2, parsed.records().size());
        var first = parsed.records().getFirst();
        assertEquals(java.util.List.of("Żuk, Maja", "Open Methods Consortium"), first.bibliography().authors());
        assertEquals(2026, first.bibliography().publicationYear());
        assertEquals("10.5555/zotero.3", first.bibliography().doi());
        assertEquals(java.util.List.of("systematic review"), first.collections());
        assertEquals(java.util.List.of("unicode", "zotero"), first.tags());
        assertEquals(1, first.ignoredAttachments());
        assertNull(parsed.records().get(1).bibliography().publicationYear());
    }

    @Test
    void malformedUtf8JsonRisAndBibtexAreExplicitErrors() {
        assertThrows(IllegalArgumentException.class,
                () -> parser.parse(Format.BIBTEX, new byte[]{(byte) 0xc3, (byte) 0x28}));
        assertFalse(parser.parse(Format.CSL_JSON, "not-json".getBytes()).errors().isEmpty());
        assertFalse(parser.parse(Format.RIS, "TY  - SOFTWARE\nTI  - bad\nER  -".getBytes()).errors().isEmpty());
        assertFalse(parser.parse(Format.BIBTEX, "@article{broken".getBytes()).errors().isEmpty());
    }

    @Test
    void latexAndHtmlRemainInertText() {
        var parsed = parser.parse(Format.BIBTEX, """
                @article{attack,title={\\input{/etc/passwd} <img src=x onerror=alert(1)>},
                  author={{Research and Development Group}},url={https://example.invalid/do-not-fetch},
                  file={file:///etc/passwd}}
                """.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertTrue(parsed.errors().isEmpty());
        assertEquals("\\input/etc/passwd <img src=x onerror=alert(1)>", parsed.records().getFirst().bibliography().title());
        assertEquals(java.util.List.of("Research and Development Group"), parsed.records().getFirst().bibliography().authors());
        assertEquals(1, parsed.records().getFirst().ignoredAttachments());
    }

    private static byte[] fixture(String name) throws Exception {
        return Files.readAllBytes(Path.of("..", "contracts", "bibliography", "fixtures", name));
    }

    @Test void supportsDocumentedTypeVariantsAndPartialMetadata() {
        for(String type:java.util.List.of("article","book","booklet","inbook","incollection","inproceedings","conference",
                "phdthesis","mastersthesis","techreport","online","webpage","misc","unpublished","manual")) {
            var result=parser.parse(Format.BIBTEX,("@"+type+"(key, title=\"A {quoted} title\", author={Family, Given and {Group and Society}},year=2023)").getBytes());
            assertTrue(result.errors().isEmpty(),type+": "+result.errors());assertEquals("A quoted title",result.records().getFirst().bibliography().title());
        }
        for(String type:java.util.List.of("JOUR","JFULL","EJOUR","BOOK","CHAP","CONF","CPAPER","THES","RPRT","ELEC","WEB","GEN","UNPB")) {
            var result=parser.parse(Format.RIS,("TY  - "+type+"\nT1  - Partial title\nA1  - Example, Ada\nY1  - 2021\nPB  - Publisher\nER  -\n").getBytes());
            assertTrue(result.errors().isEmpty(),type);assertEquals(2021,result.records().getFirst().bibliography().publicationYear());
        }
        for(String type:java.util.List.of("article-journal","article","book","chapter","paper-conference","thesis","report","webpage","document","dataset")) {
            var result=parser.parse(Format.CSL_JSON,("{\"items\":[{\"type\":\""+type+"\",\"title\":\"Partial\",\"keyword\":\"One; Two\"}]}").getBytes());
            assertTrue(result.errors().isEmpty(),type);assertEquals(java.util.List.of("one","two"),result.records().getFirst().tags());
        }
    }

    @Test void datesRespectTheBibliographyYearRangeAndInvalidDatesStayVisible() {
        for(String year:java.util.List.of("999","3000","9999")) {
            var result=parser.parse(Format.BIBTEX,("@book{date,title={Dated publication},year={"+year+"}}").getBytes());
            assertEquals(Integer.valueOf(year),result.records().getFirst().bibliography().publicationYear());
        }
        assertNull(parser.parse(Format.BIBTEX,"@book{date,title={Undated},year={n.d.}}".getBytes()).records().getFirst().bibliography().publicationYear());
        for(String year:java.util.List.of("0","0000","20240","unknown"))
            assertEquals(1,parser.parse(Format.BIBTEX,("@book{date,title={Invalid date},year={"+year+"}}").getBytes()).errors().size());
    }

    @Test void recoverableSyntaxErrorsRetainGoodRecordsAndLocations() {
        var result=parser.parse(Format.BIBTEX,"""
                @article{bad,title="Unclosed quoted value}
                @book{good,title={Recovered},author={Example, Ada}}
                """.getBytes());
        assertFalse(result.errors().isEmpty());assertTrue(result.records().stream().anyMatch(r->"Recovered".equals(r.bibliography().title())));
        for(String invalid:java.util.List.of("@article noOpen","@article{key}","@article{key, = {missing name}}",
                "@article{key,title {missing equals}}","@article{key,title=}","@article{key,doi={not-a-doi}}",
                "@article{key,url={file:///etc/passwd}}","@article{bad key,title={invalid key}}","no records"))
            assertFalse(parser.parse(Format.BIBTEX,invalid.getBytes()).errors().isEmpty(),invalid);
        assertEquals(3,parser.parse(Format.BIBTEX,"@comment{ignored}\n@string{test=\"macro\"}\n@preamble{ignored}".getBytes()).errors().size());
        assertTrue(parser.parse(Format.BIBTEX,new byte[0]).errors().isEmpty());
    }

    @Test void risRecoveryContinuationUnknownTypesAndMissingTerminatorRemainVisible() {
        var result=parser.parse(Format.RIS,"""
                This is ignored before TY
                TY  - JOUR
                TI  - First line
                  continued title
                AU  -
                L2  - https://example.invalid/attachment
                ER  -
                TY  - BOOK
                TI  - Missing ER
                TY  - GEN
                TI  - Recovered record
                ER  -
                TY  - GEN
                TI  - Missing final ER
                """.getBytes());
        assertEquals(2,result.records().size());assertEquals(2,result.errors().size());
        assertEquals("First line continued title",result.records().getFirst().bibliography().title());
        assertEquals(1,result.records().getFirst().ignoredAttachments());
        assertFalse(parser.parse(Format.RIS,"nothing".getBytes()).errors().isEmpty());
        assertTrue(parser.parse(Format.RIS,new byte[0]).errors().isEmpty());
    }

    @Test void cslInvalidRecordsDoNotDiscardValidSiblingsAndFileRecordLimitIsBounded() {
        var batch=parser.parse(Format.CSL_JSON,"""
                [{"type":"report","title":"valid","id":"https://example.invalid/id","author":[{"given":"Ada"}]},
                 {"type":"software","title":"unsupported"},{"type":"report","title":100},
                 {"type":"report","title":"invalid year","issued":{"date-parts":[["2025"]]}},
                 {"type":"report","title":"missing name","author":[{}]},null,{},
                 {"type":"report","title":"bad authors","author":"not an array"},
                 {"type":"book","title":"partial","note":"ignored","collection":"Reports","categories":null}]
                """.getBytes());
        assertEquals(2,batch.records().size());assertEquals(7,batch.errors().size());
        assertEquals(1,parser.parse(Format.CSL_JSON,"[{\"type\":\"book\",\"title\":\"No authors\",\"author\":null}]".getBytes()).records().size());
        assertEquals(java.util.List.of("Ada"),batch.records().getFirst().bibliography().authors());
        assertFalse(batch.records().getLast().warnings().isEmpty());
        assertFalse(parser.parse(Format.CSL_JSON,"{}".getBytes()).errors().isEmpty());
        assertFalse(parser.parse(Format.CSL_JSON,"[] {}".getBytes()).errors().isEmpty());
        assertThrows(dev.researchhub.shared.error.PayloadTooLargeException.class,()->parser.parse(Format.BIBTEX,
            "@book{k,title={record}}\n".repeat(1001).getBytes()));
        assertThrows(dev.researchhub.shared.error.PayloadTooLargeException.class,()->parser.parse(Format.RIS,
            "TY  - GEN\nTI  - record\nER  -\n".repeat(1001).getBytes()));
        assertThrows(dev.researchhub.shared.error.PayloadTooLargeException.class,()->parser.parse(Format.CSL_JSON,
            ("["+"{\"type\":\"report\",\"title\":\"record\"},".repeat(1000)+"{\"type\":\"report\",\"title\":\"record\"}]").getBytes()));
    }
}

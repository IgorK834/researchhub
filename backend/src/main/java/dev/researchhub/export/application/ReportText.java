package dev.researchhub.export.application;

import dev.researchhub.export.domain.Report.*;
import java.util.List;

/** Deterministic MVP numeric style, shared by every renderer. No invented author/date metadata. */
public final class ReportText {
    private ReportText() {}
    public static String inline(Inline inline) {
        return inline instanceof Text text ? text.text() : citation((Citation)inline);
    }
    public static String plain(List<Inline> content) { return content.stream().map(ReportText::inline).reduce("",String::concat); }
    public static String citation(Citation citation) {
        return "["+citation.number()+location(citation.reference())+"]";
    }
    private static String location(SourceReference s) {
        if (s.pageStart()!=null) return ", p. "+s.pageStart()+(s.pageEnd()!=null && !s.pageEnd().equals(s.pageStart()) ? "-"+s.pageEnd() : "");
        if (s.sectionTitle()!=null && !s.sectionTitle().isBlank()) return ", "+s.sectionTitle();
        return s.spans().isEmpty() ? "" : ", "+s.spans().getFirst().unitId();
    }
    public static String bibliography(BibliographyEntry entry) {
        var s=entry.source();
        return "["+entry.number()+"] "+s.title()+". Source version "+s.versionNumber()+" ("+s.sourceVersionId()+"). SHA-256: "+s.sha256()+".";
    }
    public static String provenance(AnalysisProvenance p) {
        if (p==null) return "";
        String inputs=p.inputs().stream().map(s -> s.title()+" (v"+s.versionNumber()+", "+s.sourceVersionId()+")")
            .reduce((a,b) -> a+"; "+b).orElse("");
        return "Source: "+inputs+". Analysis: "+p.analysisId()+"; execution: "+p.executionId()+"; output: "+p.outputId()+"; code SHA-256: "+p.codeSha256()+".";
    }
}

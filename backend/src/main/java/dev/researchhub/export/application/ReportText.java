package dev.researchhub.export.application;

import dev.researchhub.export.domain.Report.*;
import java.util.List;

/** Deterministic MVP numeric style, shared by every renderer. No invented author/date metadata. */
public final class ReportText {
    private ReportText() {}
    public static String inline(Inline inline) {
        return switch(inline) {case Text t -> t.text();case Citation c -> citation(c);case InlineMath m -> m.math().accessibleText();};
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
        var metadata = s.bibliography();
        var description = new StringBuilder();
        if (metadata != null && !metadata.authors().isEmpty()) description.append(String.join("; ", metadata.authors())).append(". ");
        description.append(s.title()).append('.');
        if (metadata != null) {
            if (metadata.publicationYear() != null) description.append(" ").append(metadata.publicationYear()).append('.');
            if (metadata.venue() != null) description.append(" ").append(metadata.venue()).append('.');
            if (metadata.doi() != null) description.append(" DOI: ").append(metadata.doi()).append('.');
            if (metadata.url() != null) description.append(" URL: ").append(metadata.url()).append('.');
            if (metadata.citationKey() != null) description.append(" Citation key: ").append(metadata.citationKey()).append('.');
        }
        return "["+entry.number()+"] "+description+" Source version "+s.versionNumber()+" ("+s.sourceVersionId()+"). SHA-256: "+s.sha256()+".";
    }
    public static String provenance(AnalysisProvenance p) {
        if (p==null) return "";
        if(p.solution()!=null) {
            var s=p.solution();
            return "PROBLEM: analysis "+p.analysisId()+"; execution "+p.executionId()+"; output "+p.outputId()
                +"; step "+s.stepId()+"; conversation "+s.conversationId()+". Arithmetic: "+s.arithmetic()
                +"; interpretation: "+s.interpretation()+"; domain "+s.domain()+". Input SHA-256: "+s.inputHash()
                +"; plan SHA-256: "+s.planHash()+"; candidate SHA-256: "+s.candidateHash()
                +". Runtime: "+s.runtimeVersion()+"; image: "+s.imageId()+"; verification: "+s.verificationVersion()
                +"; precision: "+s.precision()+"; code hashes: "+new java.util.TreeMap<>(s.codeHashes())+".";
        }
        String inputs=p.inputs().stream().map(s -> s.title()+" (v"+s.versionNumber()+", "+s.sourceVersionId()+")")
            .reduce((a,b) -> a+"; "+b).orElse("");
        return "Source: "+inputs+". Analysis: "+p.analysisId()+"; execution: "+p.executionId()+"; output: "+p.outputId()+"; code SHA-256: "+p.codeSha256()+".";
    }
    public static String provenance(AnalysisProvenance p,dev.researchhub.shared.localization.ContentLanguage language) {
        if(language==dev.researchhub.shared.localization.ContentLanguage.EN)return provenance(p);
        if(p==null)return "";
        if(p.solution()!=null) {
            var s=p.solution();
            return "PROBLEM: analiza "+p.analysisId()+"; wykonanie "+p.executionId()+"; wynik "+p.outputId()
                +"; krok "+s.stepId()+"; rozmowa "+s.conversationId()+". Arytmetyka: "+s.arithmetic()
                +"; interpretacja: "+s.interpretation()+"; dziedzina "+s.domain()+". SHA-256 danych: "+s.inputHash()
                +"; SHA-256 planu: "+s.planHash()+"; SHA-256 kandydata: "+s.candidateHash()
                +". Środowisko: "+s.runtimeVersion()+"; obraz: "+s.imageId()+"; weryfikacja: "+s.verificationVersion()
                +"; precyzja: "+s.precision()+"; skróty kodu: "+new java.util.TreeMap<>(s.codeHashes())+".";
        }
        String inputs=p.inputs().stream().map(s -> s.title()+" (v"+s.versionNumber()+", "+s.sourceVersionId()+")").collect(java.util.stream.Collectors.joining("; "));
        return "Źródło: "+inputs+". Analiza: "+p.analysisId()+"; wykonanie: "+p.executionId()+"; wynik: "+p.outputId()+"; SHA-256 kodu: "+p.codeSha256()+".";
    }
}

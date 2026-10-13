package dev.researchhub.export.infrastructure;

import dev.researchhub.export.domain.Report.*;
import java.util.*;

/** Plain-text citeproc result shared by the three escaped renderers. */
final class FormattedBibliography {
    static final FormattedBibliography EMPTY=new FormattedBibliography(Map.of(),List.of());
    private final Map<String,String> citations;
    private final List<String> entries;
    FormattedBibliography(Map<String,String> citations,List<String> entries) {
        this.citations=Map.copyOf(citations);this.entries=List.copyOf(entries);
    }
    List<String> entries(){return entries;}
    String inline(Inline inline) {
        if(inline instanceof Text text)return text.text();
        if(inline instanceof InlineMath math)return math.math().accessibleText();
        var citation=(Citation)inline;
        return withLocation(citations.getOrDefault(citation.citationKey(),"["+citation.number()+"]"),citation.reference());
    }
    private static String withLocation(String formatted,SourceReference source) {
        String location="";
        if(source.pageStart()!=null)location="p. "+source.pageStart()+(source.pageEnd()!=null && !source.pageEnd().equals(source.pageStart()) ? "–"+source.pageEnd() : "");
        else if(source.sectionTitle()!=null && !source.sectionTitle().isBlank())location=source.sectionTitle();
        else if(!source.spans().isEmpty())location=source.spans().getFirst().unitId();
        if(location.isEmpty())return formatted;
        if(formatted.endsWith(")"))return formatted.substring(0,formatted.length()-1)+", "+location+")";
        if(formatted.endsWith("]"))return formatted.substring(0,formatted.length()-1)+", "+location+"]";
        return formatted+", "+location;
    }
}

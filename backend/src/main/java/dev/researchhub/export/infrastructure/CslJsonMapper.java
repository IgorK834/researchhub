package dev.researchhub.export.infrastructure;

import de.undercouch.citeproc.csl.*;
import dev.researchhub.export.domain.Report.BibliographyEntry;
import java.util.*;

/** Converts the frozen ResearchHub bibliography contract to the equivalent deterministic CSL-JSON item. */
public final class CslJsonMapper {
    public Map<String,Object> toCslJson(BibliographyEntry entry) {
        var source=entry.source();var metadata=source.bibliography();
        return new dev.researchhub.source.application.BibliographyCslMapper().toCsl(key(entry),
            metadata!=null&&metadata.venue()!=null?"article-journal":"document",source.title(),
            metadata==null?null:new dev.researchhub.source.application.SourceBibliography(metadata.title(),metadata.authors(),
                metadata.publicationYear(),metadata.doi(),metadata.venue(),metadata.url(),metadata.citationKey()));
    }

    CSLItemData toItem(BibliographyEntry entry) {
        var source=entry.source();var metadata=source.bibliography();
        var builder=new CSLItemDataBuilder().id(key(entry))
            .type(metadata!=null && metadata.venue()!=null ? CSLType.ARTICLE_JOURNAL : CSLType.DOCUMENT)
            .title(source.title());
        if(metadata!=null) {
            if(!metadata.authors().isEmpty())builder.author(metadata.authors().stream().map(name -> {
                var parts=name.split(",",2);
                return parts.length==2 ? new CSLNameBuilder().family(parts[0].strip()).given(parts[1].strip()).build()
                    : new CSLNameBuilder().literal(name).build();
            }).toArray(CSLName[]::new));
            if(metadata.publicationYear()!=null)builder.issued(metadata.publicationYear());
            if(metadata.venue()!=null)builder.containerTitle(metadata.venue());
            if(metadata.doi()!=null)builder.DOI(metadata.doi());
            if(metadata.url()!=null)builder.URL(metadata.url());
            if(metadata.citationKey()!=null)builder.citationKey(metadata.citationKey());
        }
        return builder.build();
    }

    static String key(BibliographyEntry entry) {
        var metadata=entry.source().bibliography();
        return metadata!=null && metadata.citationKey()!=null ? metadata.citationKey() : "rh-"+entry.source().sourceId();
    }
}

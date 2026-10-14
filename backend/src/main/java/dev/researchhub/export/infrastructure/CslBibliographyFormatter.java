package dev.researchhub.export.infrastructure;

import de.undercouch.citeproc.CSL;
import de.undercouch.citeproc.ListItemDataProvider;
import dev.researchhub.export.domain.Report;
import java.io.IOException;
import java.util.*;

/** Uses only pinned, classpath-bundled CSL styles/locales; no style or locale is ever fetched remotely. */
final class CslBibliographyFormatter {
    private final CslJsonMapper mapper=new CslJsonMapper();

    FormattedBibliography format(Report report) {
        if(report.bibliography().isEmpty())return new FormattedBibliography(Map.of(),List.of(),report.exportLanguage());
        var items=report.bibliography().stream().map(mapper::toItem).toList();
        try {
            var processor=new CSL(new ListItemDataProvider(items),report.citationStyle().cslId(),report.exportLanguage().locale());
            processor.setOutputFormat("text");processor.setConvertLinks(false);
            var orderedKeys=report.bibliography().stream().map(CslJsonMapper::key).toList();
            var citations=new LinkedHashMap<String,String>();
            for(String key:orderedKeys) for(var rendered:processor.makeCitation(key))
                citations.put(orderedKeys.get(rendered.getIndex()),clean(rendered.getText()));
            var bibliography=processor.makeBibliography();
            return new FormattedBibliography(citations,Arrays.stream(bibliography.getEntries()).map(CslBibliographyFormatter::clean).toList(),report.exportLanguage());
        } catch(IOException|RuntimeException failure) {
            throw new IllegalStateException("Bundled citation style could not be rendered",failure);
        }
    }
    private static String clean(String value) {
        return value.replace('\u00a0',' ').replaceAll("[\\r\\n\\t]+"," ").replaceAll(" {2,}"," ").strip();
    }
}

package dev.researchhub.export.infrastructure;

import dev.researchhub.export.domain.Report;

/** A deterministic companion database for the editable LaTeX bundle. */
final class BibtexExporter {
    String render(Report report) {
        var out=new StringBuilder("% Generated from the frozen ResearchHub report snapshot.\n");
        for(var entry:report.bibliography()) {
            var source=entry.source();var metadata=source.bibliography();
            out.append('@').append(metadata!=null && metadata.venue()!=null ? "article" : "misc")
                .append('{').append(CslJsonMapper.key(entry)).append(",\n")
                .append("  title = {").append(value(source.title())).append("}");
            if(metadata!=null) {
                if(!metadata.authors().isEmpty())out.append(",\n  author = {").append(value(String.join(" and ",metadata.authors()))).append('}');
                if(metadata.publicationYear()!=null)out.append(",\n  year = {").append(metadata.publicationYear()).append('}');
                if(metadata.venue()!=null)out.append(",\n  journal = {").append(value(metadata.venue())).append('}');
                if(metadata.doi()!=null)out.append(",\n  doi = {").append(value(metadata.doi())).append('}');
                if(metadata.url()!=null)out.append(",\n  url = {").append(value(metadata.url())).append('}');
            }
            out.append("\n}\n\n");
        }
        return out.toString();
    }
    private static String value(String input) {
        var escaped=new StringBuilder(input.length());
        for(int i=0;i<input.length();i++) {
            switch(input.charAt(i)) {
                case '\\' -> escaped.append("\\textbackslash{}");
                case '{' -> escaped.append("\\{");
                case '}' -> escaped.append("\\}");
                case '%','#','&','_' -> escaped.append('\\').append(input.charAt(i));
                case '\r','\n' -> escaped.append(' ');
                default -> escaped.append(input.charAt(i));
            }
        }
        return escaped.toString();
    }
}

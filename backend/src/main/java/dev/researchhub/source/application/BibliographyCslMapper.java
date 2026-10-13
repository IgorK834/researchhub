package dev.researchhub.source.application;

import java.util.*;
import tools.jackson.databind.JsonNode;

/** Shared CSL-JSON mapping used by file migration and frozen report export. Values stay metadata. */
public final class BibliographyCslMapper {
    public SourceBibliography fromCsl(JsonNode item) {
        var authors=new ArrayList<String>();
        var names=item.path("author");
        if(!names.isMissingNode()&&!names.isNull()&&!names.isArray())
            throw new IllegalArgumentException("CSL authors must be an array");
        for(var author:names) {
            String literal=text(author,"literal");
            if(literal!=null)authors.add(literal);
            else {
                String family=text(author,"family"),given=text(author,"given");
                if(family!=null)authors.add(given==null?family:family+", "+given);
                else if(given!=null)authors.add(given);
                else throw new IllegalArgumentException("A CSL author needs literal, family, or given metadata");
            }
        }
        Integer year=null;
        var parts=item.path("issued").path("date-parts");
        if(parts.isArray()&&!parts.isEmpty()&&parts.get(0).isArray()&&!parts.get(0).isEmpty()) {
            var value=parts.get(0).get(0);
            if(!value.isIntegralNumber())throw new IllegalArgumentException("CSL publication year must be an integer");
            year=value.asInt();
        }
        String key=text(item,"citation-key");
        if(key==null) {
            String id=text(item,"id");
            // Zotero commonly exports a numeric item id; URL ids are reference identities, not citation keys.
            if(id!=null&&id.matches("[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}"))key=id;
            else if(item.path("id").isIntegralNumber())key=item.path("id").asString();
        }
        return SourceBibliography.from(new SourceBibliography(text(item,"title"),authors,year,text(item,"DOI"),
                text(item,"container-title"),text(item,"URL"),key).toDomain());
    }

    public Map<String,Object> toCsl(String id,String type,String title,SourceBibliography metadata) {
        var result=new LinkedHashMap<String,Object>();result.put("id",id);result.put("type",type);result.put("title",title);
        if(metadata!=null) {
            if(!metadata.authors().isEmpty())result.put("author",metadata.authors().stream().map(name->{
                var parts=name.split(",",2);
                return parts.length==2?Map.of("family",parts[0].strip(),"given",parts[1].strip()):Map.of("literal",name);
            }).toList());
            if(metadata.publicationYear()!=null)result.put("issued",Map.of("date-parts",List.of(List.of(metadata.publicationYear()))));
            if(metadata.venue()!=null)result.put("container-title",metadata.venue());
            if(metadata.doi()!=null)result.put("DOI",metadata.doi());
            if(metadata.url()!=null)result.put("URL",metadata.url());
            if(metadata.citationKey()!=null)result.put("citation-key",metadata.citationKey());
        }
        return Collections.unmodifiableMap(result);
    }

    private static String text(JsonNode item,String field) {
        var value=item.path(field);
        if(value.isMissingNode()||value.isNull())return null;
        if(!value.isString())throw new IllegalArgumentException("CSL "+field+" must be text");
        return value.asString().isBlank()?null:value.asString().strip();
    }
}

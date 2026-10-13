package dev.researchhub.source.infrastructure;

import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.*;
import dev.researchhub.source.domain.BibliographicMetadata;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.*;

/** Fixed-host HTTPS Crossref adapter with bounded I/O and no redirect or discovered-URL following. */
@Component
public final class CrossrefBibliographicLookup implements BibliographicLookup,AutoCloseable {
    static final int MAX_RESPONSE_BYTES=256*1024;
    private static final URI CROSSREF=URI.create("https://api.crossref.org");
    private final ObjectMapper json;
    private final boolean enabled;
    private final String userAgent;
    private final Duration timeout;
    private final URI endpoint;
    private final HttpClient client;

    @Autowired
    public CrossrefBibliographicLookup(ObjectMapper json,
        @Value("${researchhub.sources.metadata-lookup.enabled:false}") boolean enabled,
        @Value("${researchhub.sources.metadata-lookup.contact-address:}") String contact,
        @Value("${researchhub.sources.metadata-lookup.timeout:PT5S}") Duration timeout) {
        this(json,enabled,contact,timeout,CROSSREF);
    }

    CrossrefBibliographicLookup(ObjectMapper json,boolean enabled,String contact,Duration timeout,URI endpoint) {
        if(timeout==null || timeout.isZero() || timeout.isNegative() || timeout.compareTo(Duration.ofSeconds(30))>0)
            throw new IllegalArgumentException("Metadata lookup timeout must be positive and at most 30 seconds");
        if(enabled && (contact==null || !contact.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") || contact.chars().anyMatch(Character::isISOControl)))
            throw new IllegalArgumentException("A valid metadata lookup contact address is required when Crossref is enabled");
        this.json=json;this.enabled=enabled;this.timeout=timeout;this.endpoint=endpoint;
        this.userAgent="ResearchHub/1.0"+(contact==null || contact.isBlank() ? "" : " (mailto:"+contact+")");
        this.client=HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    public boolean available(){return enabled;}

    public Optional<SourceBibliography> lookup(String doi) {
        if(!enabled)throw new ApiException(ApiErrorCode.METADATA_LOOKUP_UNAVAILABLE,
            "Bibliographic metadata lookup is not configured on this server");
        try {
            var encoded=URLEncoder.encode(doi,StandardCharsets.UTF_8).replace("+","%20");
            var request=HttpRequest.newBuilder(endpoint.resolve("/works/"+encoded)).timeout(timeout)
                .header("Accept","application/json").header("User-Agent",userAgent).GET().build();
            var response=client.send(request,HttpResponse.BodyHandlers.ofInputStream());
            try(var body=response.body()) {
                if(response.statusCode()==404)return Optional.empty();
                if(response.statusCode()<200 || response.statusCode()>=300)throw failed();
                long declared=response.headers().firstValueAsLong("Content-Length").orElse(-1);
                if(declared>MAX_RESPONSE_BYTES)throw failed();
                byte[] bytes=body.readNBytes(MAX_RESPONSE_BYTES+1);
                if(bytes.length>MAX_RESPONSE_BYTES)throw failed();
                return Optional.of(parse(doi,json.readTree(bytes)));
            }
        } catch(ApiException safe) { throw safe; }
        catch(InterruptedException interrupted) { Thread.currentThread().interrupt();throw failed(); }
        catch(IOException|RuntimeException unsafe) { throw failed(); }
    }

    private SourceBibliography parse(String requestedDoi,JsonNode root) {
        var message=root.path("message");
        if(!root.isObject() || !message.isObject())throw new IllegalArgumentException("Invalid Crossref response");
        String title=first(message.get("title"));
        if(title==null)throw new IllegalArgumentException("Crossref response has no title");
        var authors=new ArrayList<String>();var authorNodes=message.get("author");
        if(authorNodes!=null) {
            if(!authorNodes.isArray() || authorNodes.size()>100)throw new IllegalArgumentException("Invalid Crossref authors");
            for(var author:authorNodes) {
                String literal=text(author.get("name"));
                if(literal==null) {
                    String family=text(author.get("family")),given=text(author.get("given"));
                    literal=family==null ? given : given==null ? family : family+", "+given;
                }
                if(literal!=null)authors.add(literal);
            }
        }
        Integer year=year(message,"published-print");
        if(year==null)year=year(message,"published-online");
        if(year==null)year=year(message,"issued");
        String venue=first(message.get("container-title"));
        String url=text(message.get("URL"));
        String key=key(authors.isEmpty() ? null : authors.getFirst(),year,requestedDoi);
        var normalized=new BibliographicMetadata(title,authors,year,requestedDoi,venue,url,key);
        return SourceBibliography.from(normalized);
    }

    private static String first(JsonNode value) {
        if(value==null || value.isNull())return null;
        if(!value.isArray() || value.size()>20)return null;
        for(var item:value) {String result=text(item);if(result!=null)return result;}
        return null;
    }
    private static String text(JsonNode value) {return value!=null && value.isString() && !value.asString().isBlank() ? value.asString() : null;}
    private static Integer year(JsonNode message,String field) {
        var parts=message.path(field).path("date-parts");
        if(!parts.isArray() || parts.isEmpty() || !parts.get(0).isArray() || parts.get(0).isEmpty() || !parts.get(0).get(0).isIntegralNumber())return null;
        int year=parts.get(0).get(0).asInt();return year>=1 && year<=9999 ? year : null;
    }
    private static String key(String author,Integer year,String doi) {
        String base=author==null ? "Crossref" : author.replaceAll("[^A-Za-z0-9]","");
        if(base.isBlank())base="Crossref";if(base.length()>60)base=base.substring(0,60);
        try {
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(doi.getBytes(StandardCharsets.UTF_8))).substring(0,8);
            return base+(year==null ? "" : year)+"_"+hash;
        } catch(java.security.NoSuchAlgorithmException impossible) {throw new IllegalStateException(impossible);}
    }
    private static ApiException failed(){return new ApiException(ApiErrorCode.METADATA_LOOKUP_FAILED,
        "Bibliographic metadata lookup could not be completed. Try again later");}
    @jakarta.annotation.PreDestroy public void close(){client.close();}
}

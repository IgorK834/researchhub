package dev.researchhub.document.infrastructure;

import dev.researchhub.document.application.DocumentTemplateContracts.*;
import dev.researchhub.shared.error.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.*;
import tools.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Local, reviewed editor JSON. No template engine, LaTeX evaluation, network or model request. */
@Component
public class BundledDocumentTemplates {
    public static final List<String> IDS=List.of("lab-report","literature-review","thesis-chapter","statistical-report");
    private static final Set<String> NODES=Set.of("doc","heading","paragraph","text","bulletList","orderedList","listItem","table","tableRow","tableHeader","tableCell","blockquote","horizontalRule","hardBreak");
    private final Map<String,Template> bundled;
    private final ObjectMapper json;
    public BundledDocumentTemplates(ObjectMapper json) {
        this.json=json;var values=new LinkedHashMap<String,Template>();
        for(String locale:List.of("en","pl"))for(String id:IDS) {
            try(var input=new ClassPathResource("templates/documents/"+id+"."+locale+".json").getInputStream()) {
                byte[] bytes=input.readAllBytes();var root=json.readTree(bytes);validate(root);
                if(!id.equals(root.path("id").asString())||!locale.equals(root.path("locale").asString()))throw new IllegalArgumentException("Template resource identity mismatch");
                var placeholders=new ArrayList<Placeholder>();
                for(var p:root.path("requiredPlaceholders"))placeholders.add(new Placeholder(p.path("id").asString(),p.path("hint").asString()));
                values.put(id+":"+locale,new Template(id,root.path("version").asInt(),locale,root.path("title").asString(),
                    root.path("description").asString(),placeholders,root.path("content"),hash(bytes)));
            }catch(IOException failed){throw new IllegalStateException("Bundled document template is unavailable",failed);}
        }
        bundled=Map.copyOf(values);
    }
    public List<Template> list(String locale) { locale=locale(locale);final String selected=locale;return IDS.stream().map(id->copy(bundled.get(id+":"+selected))).toList(); }
    public Template find(String id,int version,String locale) {
        var template=bundled.get(id+":"+locale(locale));
        if(template==null)throw new ResourceNotFoundException("Document template was not found");
        if(version!=template.version())throw new ConflictException("Template version changed; reload the catalog before creating a document");
        return copy(template);
    }
    public static String locale(String value) {
        if(!Set.of("en","pl").contains(value==null?"":value))throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Template locale must be en or pl");
        return value;
    }
    private static Template copy(Template t){return new Template(t.id(),t.version(),t.locale(),t.title(),t.description(),t.requiredPlaceholders(),t.content(),t.sha256());}
    public String instantiate(Template template,UUID operation) {
        var content=template.content().deepCopy();identities(content,operation);return json.writeValueAsString(content);
    }
    private static void identities(JsonNode node,UUID operation) {
        if(Set.of("paragraph","heading").contains(node.path("type").asString(""))) {
            var attrs=node.path("attrs").isObject()?(ObjectNode)node.path("attrs"):((ObjectNode)node).putObject("attrs");attrs.put("blockId",UUID.randomUUID().toString()).put("originIntent","IMPORTED").put("importOperationId",operation.toString());
        }
        for(var child:node.path("content"))identities(child,operation);
    }
    public static void validate(JsonNode root) {
        if(!root.isObject()||!root.path("id").asString("").matches("[a-z][a-z-]{1,40}")||root.path("version").asInt()<1
            ||!Set.of("en","pl").contains(root.path("locale").asString())||root.path("title").asString("").isBlank()
            ||root.path("description").asString("").isBlank()||!root.path("requiredPlaceholders").isArray()
            ||root.path("requiredPlaceholders").isEmpty()||!"doc".equals(root.path("content").path("type").asString()))throw new IllegalArgumentException("Invalid bundled template manifest");
        var keys=new HashSet<String>();
        for(var p:root.path("requiredPlaceholders")) {
            String key=p.path("id").asString("");
            if(!key.matches("[a-z][a-z0-9-]{0,39}")||!keys.add(key)||p.path("hint").asString("").isBlank()
                ||!root.path("content").toString().contains("[TODO:"+key+"]"))throw new IllegalArgumentException("Invalid required template placeholder");
        }
        validateNode(root.path("content"),0,new int[]{0});
    }
    private static void validateNode(JsonNode node,int depth,int[] count) {
        String type=node.path("type").asString("");
        if(depth>32||++count[0]>2000||!NODES.contains(type))throw new IllegalArgumentException("Unsupported template node");
        if("heading".equals(type)&&(node.path("attrs").path("level").asInt()<1||node.path("attrs").path("level").asInt()>6))throw new IllegalArgumentException("Invalid template heading");
        if("text".equals(type)&&(!node.path("text").isString()||node.path("text").asString().isBlank()))throw new IllegalArgumentException("Invalid template text");
        for(var mark:node.path("marks"))if(!Set.of("italic","bold").contains(mark.path("type").asString()))throw new IllegalArgumentException("Unsupported template mark");
        if(node.has("attrs"))for(String key:node.path("attrs").propertyNames())if(!Set.of("level","start","colspan","rowspan","colwidth").contains(key))throw new IllegalArgumentException("Unsupported template attribute");
        if(node.has("content")&&!node.path("content").isArray())throw new IllegalArgumentException("Invalid template children");
        for(var child:node.path("content"))validateNode(child,depth+1,count);
    }
    public static String hash(byte[] bytes) {try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}}
    public static String hash(String text) {return hash(text.getBytes(StandardCharsets.UTF_8));}
}

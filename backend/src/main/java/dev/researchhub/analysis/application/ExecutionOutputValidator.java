package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

/** Independently verifies the runner's untrusted bounded manifest before publishing any runtime result. */
public final class ExecutionOutputValidator {
    public static final int MAX_RESULT_BYTES=1_048_576, MAX_ARTIFACT_BYTES=8*1024*1024, MAX_TOTAL_BYTES=16*1024*1024;
    private final ObjectMapper json;
    public ExecutionOutputValidator(ObjectMapper json) {
        this.json=json.rebuild().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    }
    public Validated validate(Plan plan,Map<String,byte[]> files) {
        return validate(plan.outputs().stream().map(o -> new SandboxRunner.Output(o.name(),o.kind())).toList(),files);
    }
    public Validated validate(List<SandboxRunner.Output> declaredOutputs,Map<String,byte[]> files) {
        try {
            require(files!=null && files.size()<=11);
            long total=0;
            for (var bytes:files.values()) { require(bytes!=null); total+=bytes.length; }
            require(total<=MAX_TOTAL_BYTES);
            byte[] manifest=files.get("result.json"); require(manifest!=null && manifest.length<=MAX_RESULT_BYTES);
            Map<?,?> root=json.readValue(manifest,Map.class); keys(root,"schemaVersion","outputs");
            require("1.0".equals(root.get("schemaVersion")));
            List<?> outputs=list(root.get("outputs"),10); require(!outputs.isEmpty() && outputs.size()==declaredOutputs.size());
            Map<String,SandboxRunner.Output> expected=new HashMap<>(); declaredOutputs.forEach(o -> { require(expected.put(o.name(),o)==null); });
            Set<String> usedFiles=new HashSet<>(); usedFiles.add("result.json");
            Map<UUID,byte[]> artifacts=new LinkedHashMap<>(); List<ComputedOutput> result=new ArrayList<>();
            long cells=0;
            for (Object value:outputs) {
                require(value instanceof Map); Map<?,?> output=(Map<?,?>)value;
                String name=text(output.get("name"),100); SandboxRunner.Output declared=expected.remove(name);
                require(declared!=null && declared.kind().name().equals(output.get("kind")));
                switch (declared.kind()) {
                    case TABLE -> {
                        keys(output,"name","kind","columns","rows");
                        List<?> rawColumns=list(output.get("columns"),100); require(!rawColumns.isEmpty());
                        List<String> columns=rawColumns.stream().map(c -> text(c,256)).toList();
                        require(new HashSet<>(columns).size()==columns.size());
                        List<?> rawRows=list(output.get("rows"),10000); List<List<Object>> rows=new ArrayList<>();
                        cells+=(long)rawRows.size()*columns.size(); require(cells<=100000);
                        for (Object row:rawRows) {
                            List<?> values=list(row,100); require(values.size()==columns.size());
                            List<Object> rowValues=new ArrayList<>();
                            for (Object cell:values) {
                                require(cell==null || cell instanceof Boolean || cell instanceof Number || cell instanceof String);
                                if (cell instanceof Number number) require(Double.isFinite(number.doubleValue()));
                                if (cell instanceof String string) require(string.length()<=1024 && safeText(string));
                                rowValues.add(cell);
                            }
                            rows.add(Collections.unmodifiableList(rowValues));
                        }
                        result.add(new ComputedOutput(OutputKind.TABLE,name,columns,List.copyOf(rows),null,null));
                    }
                    case TEXT -> {
                        keys(output,"name","kind","text"); Object content=output.get("text");
                        require(content instanceof String && ((String)content).length()<=65536 && safeText((String)content));
                        result.add(new ComputedOutput(OutputKind.TEXT,name,null,null,(String)content,null));
                    }
                    case CHART -> {
                        keys(output,"name","kind","file"); String filename=text(output.get("file"),100);
                        require(filename.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\\.(png|svg)") && usedFiles.add(filename));
                        byte[] bytes=files.get(filename); require(bytes!=null && bytes.length>0 && bytes.length<=MAX_ARTIFACT_BYTES);
                        String mediaType;
                        if (filename.endsWith(".png")) {
                            require(bytes.length>=8 && Arrays.equals(Arrays.copyOf(bytes,8),new byte[]{(byte)137,80,78,71,13,10,26,10}));
                            mediaType="image/png";
                        } else { safeSvg(bytes); mediaType="image/svg+xml"; }
                        Artifact artifact=new Artifact(UUID.randomUUID(),filename,mediaType,bytes.length,sha256(bytes));
                        artifacts.put(artifact.id(),bytes.clone());
                        result.add(new ComputedOutput(OutputKind.CHART,name,null,null,null,artifact));
                    }
                }
            }
            require(expected.isEmpty() && usedFiles.equals(files.keySet()));
            return new Validated(new Result("1.0",result),Map.copyOf(artifacts));
        } catch (RuntimeException invalid) { throw new IllegalArgumentException("Invalid execution output"); }
    }
    private static void safeSvg(byte[] bytes) {
        try {
            var factory=DocumentBuilderFactory.newInstance(); factory.setNamespaceAware(true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities",false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,""); factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
            var builder=factory.newDocumentBuilder();
            builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler());
            var root=builder.parse(new ByteArrayInputStream(bytes)).getDocumentElement();
            require("svg".equals(root.getLocalName()) && "http://www.w3.org/2000/svg".equals(root.getNamespaceURI()));
            inspectSvg(root,0);
        } catch (Exception invalid) { throw new IllegalArgumentException("Invalid execution output"); }
    }
    private static void inspectSvg(Element element,int depth) {
        require(depth<32 && Set.of("svg","g","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","defs","clipPath","linearGradient","radialGradient","stop","title","desc","use").contains(element.getLocalName()));
        require("http://www.w3.org/2000/svg".equals(element.getNamespaceURI()));
        var attributes=element.getAttributes();
        for (int i=0;i<attributes.getLength();i++) {
            var attribute=attributes.item(i); String name=attribute.getNodeName().toLowerCase(Locale.ROOT);
            String value=attribute.getNodeValue().toLowerCase(Locale.ROOT).replaceAll("\\s","");
            if (name.startsWith("xmlns")) continue;
            require(!name.startsWith("on") && (!name.endsWith("href") || "use".equals(element.getLocalName()) && value.matches("#[a-z0-9_-]+"))
                && !value.contains("javascript:") && !value.contains("data:") && !value.contains("http:") && !value.contains("https:"));
            require(!value.contains("url(") || value.matches("url\\(#[a-z0-9_-]+\\)"));
        }
        var children=element.getChildNodes();
        for (int i=0;i<children.getLength();i++) {
            Node child=children.item(i);
            if (child instanceof Element nested) inspectSvg(nested,depth+1);
            else require(child.getNodeType()==Node.TEXT_NODE || child.getNodeType()==Node.COMMENT_NODE);
        }
    }
    public static String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    public static String sha256(String value) { return sha256(value.getBytes(StandardCharsets.UTF_8)); }
    private static List<?> list(Object value,int max) { require(value instanceof List && ((List<?>)value).size()<=max); return (List<?>)value; }
    private static boolean safeText(String value) { return value.chars().noneMatch(c -> c<32 && c!=9 && c!=10 && c!=13 || c==127); }
    private static String text(Object value,int max) { require(value instanceof String && !((String)value).isBlank() && ((String)value).length()<=max && safeText((String)value)); return (String)value; }
    private static void keys(Map<?,?> value,String... keys) { require(value!=null && value.keySet().equals(Set.of(keys))); }
    private static void require(boolean valid) { if (!valid) throw new IllegalArgumentException("Invalid execution output"); }
}

package dev.researchhub.analysis.application;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static dev.researchhub.analysis.application.AnalysisContracts.OutputKind.*;
import static org.junit.jupiter.api.Assertions.*;

class ExecutionOutputValidatorTest {
    final JsonMapper json=JsonMapper.builder().findAndAddModules().build();
    final ExecutionOutputValidator validator=new ExecutionOutputValidator(json);
    final List<SandboxRunner.Output> table=List.of(new SandboxRunner.Output("computed",TABLE));
    Map<String,byte[]> result(String output) {
        return Map.of("result.json",("{\"schemaVersion\":\"1.0\",\"outputs\":["+output+"]}").getBytes(StandardCharsets.UTF_8));
    }
    String validTable() { return "{\"name\":\"computed\",\"kind\":\"TABLE\",\"columns\":[\"a\",\"b\"],\"rows\":[[2,1.25],[null,true],[\"text\",\"\"]]}"; }
    @Test void validatesComputedScalarsAndRetainsNullsWithoutModelNarrative() {
        var validated=validator.validate(table,result(validTable()));
        var output=validated.result().outputs().getFirst();
        assertEquals(List.of("a","b"),output.columns());assertEquals(1.25,output.rows().getFirst().get(1));
        assertNull(output.rows().get(1).getFirst());assertEquals(true,output.rows().get(1).get(1));
        assertNull(output.text());assertTrue(validated.artifacts().isEmpty());
        assertThrows(UnsupportedOperationException.class,() -> output.rows().getFirst().add("changed"));
        var text=validator.validate(List.of(new SandboxRunner.Output("note",TEXT)),
            result("{\"name\":\"note\",\"kind\":\"TEXT\",\"text\":\"\"}"));
        assertEquals("",text.result().outputs().getFirst().text());
    }
    @Test void rejectsAmbiguousExtraMissingAndMalformedManifestContent() {
        for (String output:List.of(validTable().replace("computed","other"),validTable().replace("TABLE","TEXT"),
            validTable().replace("[\"a\",\"b\"]","[\"a\",\"a\"]"),validTable().replace("[2,1.25]","[2]"),
            validTable().replace("[2,1.25]","[{},2]"),validTable().replace("1.25","1e9999"),
            validTable().replace("1.25","NaN"),validTable().replace("\"text\"","\"\\u0000\""),
            validTable().replace("\"kind\":\"TABLE\"","\"kind\":\"TEXT\",\"kind\":\"TABLE\""),
            validTable().replace("\"rows\":","\"unexpected\":true,\"rows\":"),
            validTable().replace("[\"a\",\"b\"]","[]"))) {
            assertThrows(IllegalArgumentException.class,() -> validator.validate(table,result(output)),output);
        }
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,result(validTable()+","+validTable())));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,Map.of()));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,Map.of("result.json",new byte[1_048_577])));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,Map.of("result.json","{} {}".getBytes())));
        var files=new HashMap<>(result(validTable()));files.put("extra.txt",new byte[]{1});
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,files));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(List.of(table.getFirst(),table.getFirst()),result(validTable())));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,Map.of("result.json",
            new String(result(validTable()).get("result.json"),StandardCharsets.UTF_8).concat(" {}").getBytes(StandardCharsets.UTF_8))));
    }
    Map<String,byte[]> chart(String filename,byte[] bytes) {
        var files=new HashMap<>(result("{\"name\":\"figure\",\"kind\":\"CHART\",\"file\":\""+filename+"\"}"));
        files.put(filename,bytes);return files;
    }
    @Test void validatesHashesAndOnlyPassiveSvgAndPngChartArtifacts() {
        var expected=List.of(new SandboxRunner.Output("figure",CHART));
        byte[] png={(byte)137,80,78,71,13,10,26,10};
        var validated=validator.validate(expected,chart("chart.png",png));
        var artifact=validated.result().outputs().getFirst().artifact();
        assertEquals("image/png",artifact.mediaType());assertArrayEquals(png,validated.artifacts().get(artifact.id()));
        assertEquals(ExecutionOutputValidator.sha256(png),artifact.sha256());
        String svg="<svg xmlns=\"http://www.w3.org/2000/svg\"><defs><path id=\"line\" d=\"M0 0L1 1\"/></defs><use href=\"#line\"/><!-- passive --><text>Result</text></svg>";
        assertEquals("image/svg+xml",validator.validate(expected,chart("chart.svg",svg.getBytes(StandardCharsets.UTF_8)))
            .result().outputs().getFirst().artifact().mediaType());
        for (String unsafe:List.of("<svg/>","<svg xmlns=\"http://www.w3.org/2000/svg\"><script>bad()</script></svg>",
            svg.replace("#line","https://external.test/secret"),svg.replace("id=\"line\"","onload=\"bad()\""),
            svg.replace("<text>","<text style=\"fill:url(https://external.test)\">"),
            "<!DOCTYPE svg [<!ENTITY e SYSTEM 'file:///etc/passwd'>]>"+svg,svg.replace("<text>","<foreignObject>"),
            "<svg xmlns=\"http://www.w3.org/2000/svg\">"+"<g>".repeat(33)+"</g>".repeat(33)+"</svg>"))
            assertThrows(IllegalArgumentException.class,() -> validator.validate(expected,chart("chart.svg",unsafe.getBytes(StandardCharsets.UTF_8))));
        for (String name:List.of("../chart.png","/chart.png","nested/chart.svg","chart.html"))
            assertThrows(IllegalArgumentException.class,() -> validator.validate(expected,chart(name,png)));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(expected,chart("chart.png",new byte[]{1})));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(expected,chart("chart.png",new byte[8*1024*1024+1])));
    }
    @Test void enforcesRowCellColumnAndTextLimits() {
        for (String output:List.of(validTable().replace("\"text\"","\""+"x".repeat(1025)+"\""),
            validTable().replace("\"a\"","\""+"a".repeat(257)+"\"")))
            assertThrows(IllegalArgumentException.class,() -> validator.validate(table,result(output)));
        Map<String,Object> output=new LinkedHashMap<>();output.put("name","computed");output.put("kind","TABLE");
        output.put("columns",List.of("x"));output.put("rows",Collections.nCopies(10001,List.of(1)));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,result(json.writeValueAsString(output))));
        output.put("columns",java.util.stream.IntStream.range(0,11).mapToObj(i -> "c"+i).toList());
        output.put("rows",Collections.nCopies(10000,Collections.nCopies(11,1)));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,result(json.writeValueAsString(output))));
        assertThrows(IllegalArgumentException.class,() -> validator.validate(List.of(new SandboxRunner.Output("note",TEXT)),
            result("{\"name\":\"note\",\"kind\":\"TEXT\",\"text\":\""+"x".repeat(65537)+"\"}")));
        var total=new HashMap<>(result(validTable()));total.put("big.png",new byte[16*1024*1024]);
        assertThrows(IllegalArgumentException.class,() -> validator.validate(table,total));
    }
}

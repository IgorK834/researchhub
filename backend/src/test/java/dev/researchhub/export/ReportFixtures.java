package dev.researchhub.export;

import dev.researchhub.export.domain.Report;
import dev.researchhub.export.domain.Report.*;
import java.time.Instant;
import java.util.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;
import tools.jackson.databind.json.JsonMapper;

final class ReportFixtures {
    static final UUID W=UUID.randomUUID(), D=UUID.randomUUID(), U=UUID.randomUUID(), S=UUID.randomUUID(), V=UUID.randomUUID();
    static final Instant NOW=Instant.parse("2026-10-07T10:00:00Z");
    static final tools.jackson.databind.ObjectMapper JSON=JsonMapper.builder().findAndAddModules().build();
    static Text text(String value) { return new Text(value,Set.of()); }
    static Paragraph paragraph(String text) { return new Paragraph(List.of(text(text)),false); }
    static Cell cell(String text,boolean header) { return new Cell(header,1,1,List.of(paragraph(text))); }
    static SourceReference source() { return new SourceReference(S,V,2,"Kowalski — Pomiary", "a".repeat(64),"extract:2","b".repeat(64),"c".repeat(64),3,4,"Results",List.of(new Span("page:3",20,60))); }
    static AnalysisProvenance provenance() { return new AnalysisProvenance(UUID.randomUUID(),UUID.randomUUID(),"measurement", "d".repeat(64),List.of(source())); }
    static byte[] png() {
        try {
            var image=new BufferedImage(640,320,BufferedImage.TYPE_INT_RGB);var g=image.createGraphics();
            g.setColor(java.awt.Color.WHITE);g.fillRect(0,0,640,320);g.setColor(java.awt.Color.BLUE);
            g.drawLine(40,280,600,40);g.drawString("Frequency / Impedance",200,300);g.dispose();
            var output=new ByteArrayOutputStream();ImageIO.write(image,"png",output);return output.toByteArray();
        } catch (Exception e) { throw new RuntimeException(e); }
    }
    static Report report(List<Block> blocks) {
        return new Report("1.0",W,D,3,"Raport badań — Łódź",NOW,blocks,List.of(new BibliographyEntry(1,source())),
            List.of(new Origin(UUID.randomUUID(),UUID.randomUUID(),"HUMAN",U,"Anna",null,3,NOW,"{}")),List.of());
    }
    static Report rich() {
        var blocks=new ArrayList<Block>();
        blocks.add(new Heading(1,List.of(text("Objective"))));
        blocks.add(new Paragraph(List.of(new Text("Zażółć gęślą jaźń: ",EnumSet.allOf(Style.class)),new Citation(1,source())),false));
        blocks.add(new ListBlock(true,3,List.of(List.of(paragraph("First item"),new ListBlock(false,1,List.of(List.of(paragraph("Nested item"))))))));
        blocks.add(new Table(List.of(List.of(cell("T (°C)",true),cell("Value",true)),List.of(cell("25",false),cell("0.612",false))),"Table 1. Measurements",provenance()));
        blocks.add(dev.researchhub.export.application.ReportImages.normalize(png(),"image/png","Chart","Figure 1. Impedance",provenance()));
        blocks.add(new Container(List.of(paragraph("Quoted observation")),true));
        blocks.add(new Code("Z = U / I\nprint(Z)"));blocks.add(new Rule());blocks.add(new Equation("LATEX","E = mc^2"));
        return report(blocks);
    }
}

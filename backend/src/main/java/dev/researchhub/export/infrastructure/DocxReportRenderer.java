package dev.researchhub.export.infrastructure;

import dev.researchhub.export.domain.Report;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.export.application.ReportText;
import dev.researchhub.export.application.TableGrid;
import java.io.*;
import java.math.BigInteger;
import java.util.*;
import org.apache.poi.util.Units;
import org.apache.poi.xwpf.usermodel.*;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.*;

/** Real OOXML paragraphs, heading styles, numbering, tables and drawings; no HTML import. */
public final class DocxReportRenderer {
    public byte[] render(Report report) {
        try (var document=new XWPFDocument();var output=new ByteArrayOutputStream()) {
            configure(document,report);
            var title=document.createParagraph();title.setStyle("Title");
            var run=title.createRun();run.setText(report.title());run.setFontFamily("Times New Roman");run.setFontSize(24);run.setBold(true);
            blocks(document,document,report.blocks(),0);
            if (!report.bibliography().isEmpty()) {
                heading(document,1,List.of(new Text("References",Set.of())));
                report.bibliography().forEach(e -> paragraph(document,List.of(new Text(ReportText.bibliography(e),Set.of())),false));
            }
            document.write(output);return output.toByteArray();
        } catch (Exception failure) { throw new IllegalStateException("DOCX rendering failed",failure); }
    }
    private void configure(XWPFDocument doc,Report report) {
        doc.getProperties().getCoreProperties().setTitle(report.title());
        doc.getProperties().getCoreProperties().setDescription("ResearchHub document "+report.documentId()+", revision "+report.revision());
        var styles=doc.createStyles();styles.setDefaultFonts(new CTFontsBuilder().font());
        for (int i=1;i<=6;i++) {
            var style=CTStyle.Factory.newInstance();style.setStyleId("Heading"+i);style.setType(STStyleType.PARAGRAPH);
            style.addNewName().setVal("heading "+i);style.addNewPPr().addNewOutlineLvl().setVal(BigInteger.valueOf(i-1));
            style.getPPr().addNewKeepNext();style.addNewRPr().addNewB();styles.addStyle(new XWPFStyle(style));
        }
        for (String name:List.of("Title","Caption")) {
            var style=CTStyle.Factory.newInstance();style.setStyleId(name);style.setType(STStyleType.PARAGRAPH);
            style.addNewName().setVal(name);styles.addStyle(new XWPFStyle(style));
        }
        var section=doc.getDocument().getBody().addNewSectPr();
        var size=section.addNewPgSz();size.setW(BigInteger.valueOf(11906));size.setH(BigInteger.valueOf(16838));
        var margin=section.addNewPgMar();margin.setTop(BigInteger.valueOf(1440));margin.setBottom(BigInteger.valueOf(1440));
        margin.setLeft(BigInteger.valueOf(1440));margin.setRight(BigInteger.valueOf(1440));
        var footer=doc.createFooter(org.apache.poi.wp.usermodel.HeaderFooterType.DEFAULT);
        var p=footer.createParagraph();p.setAlignment(ParagraphAlignment.CENTER);
        p.getCTP().addNewFldSimple().setInstr("PAGE");
    }
    private static final class CTFontsBuilder {
        CTFonts font() { var f=CTFonts.Factory.newInstance();f.setAscii("Times New Roman");f.setHAnsi("Times New Roman");return f; }
    }
    private void blocks(XWPFDocument doc,IBody body,List<Block> blocks,int depth) throws Exception {
        for (Block block:blocks) switch (block) {
            case Paragraph p -> paragraph(body,p.content(),p.caption());
            case Heading h -> heading(body,h.level(),h.content());
            case ListBlock list -> {
                BigInteger num=numbering(doc,list.ordered(),list.start());
                for (var item:list.items()) {
                    var p=newParagraph(body);p.setNumID(num);p.setNumILvl(BigInteger.ZERO);
                    p.setIndentationLeft(360*(depth+1));p.setIndentationHanging(180);
                    if (!item.isEmpty() && item.getFirst() instanceof Paragraph first) {
                        inlines(p,first.content());blocks(doc,body,item.subList(1,item.size()),depth+1);
                    } else blocks(doc,body,item,depth+1);
                }
            }
            case Table table -> {
                if (!table.caption().isBlank()) paragraph(body,List.of(new Text(table.caption(),Set.of())),true);
                table(doc,body,table,depth);
                provenance(body,table.provenance());
            }
            case Image image -> {
                var p=newParagraph(body);p.setAlignment(ParagraphAlignment.CENTER);
                var r=p.createRun();double scale=Math.min(450d/image.width(),550d/image.height());
                r.addPicture(new ByteArrayInputStream(Base64.getDecoder().decode(image.pngBase64())),Document.PICTURE_TYPE_PNG,
                    image.alt(),(int)(image.width()*scale*Units.EMU_PER_POINT),(int)(image.height()*scale*Units.EMU_PER_POINT));
                p.setKeepNext(true);
                if (!image.caption().isBlank()) paragraph(body,List.of(new Text(image.caption(),Set.of())),true);
                provenance(body,image.provenance());
            }
            case Container container -> {
                int first=body.getParagraphs().size();blocks(doc,body,container.blocks(),depth);
                if (container.quote()) for (int i=first;i<body.getParagraphs().size();i++) body.getParagraphs().get(i).setIndentationLeft(360);
            }
            case Code code -> paragraph(body,List.of(new Text(code.text(),Set.of(Style.CODE))),false);
            case Rule ignored -> { var p=newParagraph(body);p.setBorderBottom(Borders.SINGLE); }
            case Equation equation -> paragraph(body,List.of(new Text(equation.source(),Set.of(Style.CODE))),false);
        }
    }
    private void table(XWPFDocument doc,IBody body,Table source,int depth) throws Exception {
        var grid=TableGrid.of(source);
        XWPFTable table;
        if (body instanceof XWPFDocument d) table=d.createTable(grid.rows().size(),grid.columns());
        else {
            var cell=(XWPFTableCell)body;
            table=new XWPFTable(cell.getCTTc().addNewTbl(),cell,grid.rows().size(),grid.columns());
            cell.insertTable(cell.getBodyElements().size(),table);
        }
        table.setWidth("100%");table.setCellMargins(80,100,80,100);
        for (int r=0;r<grid.rows().size();r++) {
            var row=table.getRow(r);var slots=grid.rows().get(r);
            if (r==0 && source.rows().getFirst().stream().allMatch(Cell::header)) row.setRepeatHeader(true);
            for (int c=grid.columns()-1;c>=0;c--) {
                var slot=slots.get(c);var cell=slot.cell();
                if (c>0 && slots.get(c-1).cell()==cell) { row.removeCell(c);continue; }
                var target=row.getCell(c);target.removeParagraph(0);
                var properties=target.getCTTc().addNewTcPr();
                if (cell.colspan()>1) properties.addNewGridSpan().setVal(BigInteger.valueOf(cell.colspan()));
                if (cell.rowspan()>1) properties.addNewVMerge().setVal(slot.continuation() ? STMerge.CONTINUE : STMerge.RESTART);
                if (cell.header()) target.setColor("F0EEE9");
                if (!slot.continuation()) {
                    blocks(doc,target,cell.blocks(),depth);
                    if (cell.header()) target.getParagraphs().forEach(p -> p.getRuns().forEach(run -> run.setBold(true)));
                }
                // OOXML cells must end in a paragraph, including when their last block is a nested table.
                if (target.getParagraphs().isEmpty() || target.getBodyElements().getLast() instanceof XWPFTable) target.addParagraph();
            }
        }
    }
    private void provenance(IBody body,AnalysisProvenance p) {
        if (p!=null) paragraph(body,List.of(new Text(ReportText.provenance(p),Set.of())),true);
    }
    private XWPFParagraph newParagraph(IBody body) {
        var p=body instanceof XWPFDocument d ? d.createParagraph() : ((XWPFTableCell)body).addParagraph();
        p.setSpacingAfter(120);p.setSpacingBetween(1.15);return p;
    }
    private void paragraph(IBody body,List<Inline> content,boolean caption) {
        var p=newParagraph(body);inlines(p,content);
        if (caption) { p.setStyle("Caption");p.getRuns().forEach(r -> { r.setFontSize(10);r.setItalic(true); }); }
    }
    private void heading(IBody body,int level,List<Inline> content) {
        var p=newParagraph(body);p.setStyle("Heading"+level);p.setKeepNext(true);inlines(p,content);
        p.getRuns().forEach(r -> { r.setBold(true);r.setFontSize(Math.max(12,22-level*2)); });
    }
    private void inlines(XWPFParagraph p,List<Inline> content) {
        for (Inline inline:content) {
            var r=p.createRun();r.setFontFamily("Times New Roman");r.setFontSize(11);
            if (inline instanceof Text text) {
                r.setBold(text.styles().contains(Style.BOLD));r.setItalic(text.styles().contains(Style.ITALIC));
                r.setStrikeThrough(text.styles().contains(Style.STRIKE));
                if (text.styles().contains(Style.UNDERLINE)) r.setUnderline(UnderlinePatterns.SINGLE);
                if (text.styles().contains(Style.CODE)) r.setFontFamily("Courier New");
            }
            String[] lines=ReportText.inline(inline).split("\n",-1);
            for (int i=0;i<lines.length;i++) { if (i>0) r.addBreak();r.setText(lines[i]); }
        }
    }
    private BigInteger numbering(XWPFDocument doc,boolean ordered,int start) {
        var numbering=doc.getNumbering()==null ? doc.createNumbering() : doc.getNumbering();
        var abstractNum=CTAbstractNum.Factory.newInstance();
        abstractNum.setAbstractNumId(BigInteger.valueOf(numbering.getAbstractNums().size()));
        var level=abstractNum.addNewLvl();level.setIlvl(BigInteger.ZERO);level.addNewStart().setVal(BigInteger.valueOf(start));
        level.addNewNumFmt().setVal(ordered ? STNumberFormat.DECIMAL : STNumberFormat.BULLET);
        level.addNewLvlText().setVal(ordered ? "%1." : "•");
        return numbering.addNum(numbering.addAbstractNum(new XWPFAbstractNum(abstractNum)));
    }
}

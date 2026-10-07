package dev.researchhub.export.infrastructure;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle;
import dev.researchhub.export.domain.Report;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.export.application.ReportText;
import dev.researchhub.export.application.TableGrid;
import java.io.ByteArrayOutputStream;
import java.util.*;

/** Paged XHTML is generated exclusively from the IR. The renderer cannot load files or network resources. */
public final class PdfReportRenderer {
    public byte[] render(Report report) {
        try (var output=new ByteArrayOutputStream()) {
            var builder=new PdfRendererBuilder();
            builder.useFont(() -> getClass().getResourceAsStream("/export/fonts/DejaVuSerif.ttf"),"Report",400,FontStyle.NORMAL,true);
            builder.useFont(() -> getClass().getResourceAsStream("/export/fonts/DejaVuSerif-Bold.ttf"),"Report",700,FontStyle.NORMAL,true);
            builder.useFont(() -> getClass().getResourceAsStream("/export/fonts/DejaVuSerif-Italic.ttf"),"Report",400,FontStyle.ITALIC,true);
            builder.useFont(() -> getClass().getResourceAsStream("/export/fonts/DejaVuSerif-BoldItalic.ttf"),"Report",700,FontStyle.ITALIC,true);
            builder.useExternalResourceAccessControl((uri,type) -> uri.startsWith("data:image/png;base64,"),
                com.openhtmltopdf.outputdevice.helper.ExternalResourceControlPriority.RUN_BEFORE_RESOLVING_URI);
            builder.useExternalResourceAccessControl((uri,type) -> uri.startsWith("data:image/png;base64,"),
                com.openhtmltopdf.outputdevice.helper.ExternalResourceControlPriority.RUN_AFTER_RESOLVING_URI);
            builder.useFont(() -> getClass().getResourceAsStream("/export/fonts/DejaVuSansMono.ttf"),"ReportCode",400,FontStyle.NORMAL,true);
            builder.useFont(() -> getClass().getResourceAsStream("/export/fonts/DejaVuSansMono-Bold.ttf"),"ReportCode",700,FontStyle.NORMAL,true);
            builder.useFont(() -> getClass().getResourceAsStream("/export/fonts/DejaVuSansMono-Oblique.ttf"),"ReportCode",400,FontStyle.ITALIC,true);
            builder.useFont(() -> getClass().getResourceAsStream("/export/fonts/DejaVuSansMono-BoldOblique.ttf"),"ReportCode",700,FontStyle.ITALIC,true);
            builder.withHtmlContent(html(report),null);builder.toStream(output);builder.run();return output.toByteArray();
        } catch (Exception failure) { throw new IllegalStateException("PDF rendering failed",failure); }
    }
    String html(Report report) {
        var html=new StringBuilder("<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><meta charset=\"UTF-8\"/><title>")
            .append(escape(report.title())).append("</title><style>")
            .append("@page { size:A4; margin:22mm 22mm 24mm; @bottom-center { content:counter(page); font-family:Report; font-size:9pt; } }")
            .append("body { font-family:Report; font-size:11pt; line-height:1.45; color:#20201e; } h1,h2,h3,h4,h5,h6 { page-break-after:avoid; line-height:1.2; } ")
            .append("h1 { font-size:22pt; } h2 { font-size:18pt; } h3 { font-size:15pt; } p { margin:0 0 9pt; orphans:3; widows:3; word-wrap:break-word; } ")
            .append("table { border-collapse:collapse; width:100%; table-layout:fixed; margin:8pt 0; -fs-table-paginate:paginate; }")
            .append("thead { display:table-header-group; } td,th { border:0.5pt solid #c9c6c0; padding:5pt; word-wrap:break-word; font-size:9pt; } ")
            .append("th { background:#f0eee9; } tr { page-break-inside:avoid; } td p,th p { margin:0; } li { margin-bottom:4pt; } ")
            .append(".caption,.provenance { font-size:9pt; color:#555; } .caption { font-style:italic; } .provenance { word-wrap:break-word; }")
            .append("code,pre { font-family:ReportCode; } .image { text-align:center; page-break-inside:avoid; } blockquote { margin:8pt 16pt; } pre { white-space:pre-wrap; word-wrap:break-word; }")
            .append("</style></head><body><h1>").append(escape(report.title())).append("</h1>");
        blocks(html,report.blocks());
        if (!report.bibliography().isEmpty()) {
            html.append("<h2>References</h2>");
            report.bibliography().forEach(e -> html.append("<p class=\"provenance\">").append(escape(ReportText.bibliography(e))).append("</p>"));
        }
        return html.append("</body></html>").toString();
    }
    private void blocks(StringBuilder html,List<Block> blocks) {
        for (Block block:blocks) switch (block) {
            case Paragraph p -> { html.append(p.caption() ? "<p class=\"caption\">" : "<p>");inlines(html,p.content());html.append("</p>"); }
            case Heading h -> { html.append("<h").append(h.level()).append('>');inlines(html,h.content());html.append("</h").append(h.level()).append('>'); }
            case ListBlock list -> {
                String tag=list.ordered() ? "ol" : "ul";html.append('<').append(tag);
                if (list.ordered()) html.append(" start=\"").append(list.start()).append('"');html.append('>');
                for (var item:list.items()) { html.append("<li>");blocks(html,item);html.append("</li>"); }
                html.append("</").append(tag).append('>');
            }
            case Table table -> {
                TableGrid.of(table);caption(html,table.caption());html.append("<table>");
                boolean header=table.rows().getFirst().stream().allMatch(c -> c.header() && c.rowspan()==1);
                for (int r=0;r<table.rows().size();r++) {
                    if (r==0) html.append(header ? "<thead>" : "<tbody>");
                    if (r==1 && header) html.append("</thead><tbody>");
                    html.append("<tr>");
                    for (Cell cell:table.rows().get(r)) {
                        String tag=cell.header() ? "th" : "td";
                        html.append('<').append(tag).append(" colspan=\"").append(cell.colspan()).append("\" rowspan=\"").append(cell.rowspan()).append("\">");
                        blocks(html,cell.blocks());html.append("</").append(tag).append('>');
                    }
                    html.append("</tr>");
                }
                html.append(header && table.rows().size()==1 ? "</thead>" : "</tbody>").append("</table>");
                provenance(html,table.provenance());
            }
            case Image image -> {
                double scale=Math.min(445d/image.width(),500d/image.height());
                html.append("<div class=\"image\"><img src=\"data:image/png;base64,").append(image.pngBase64())
                    .append("\" alt=\"").append(escape(image.alt())).append("\" style=\"width:").append((int)(image.width()*scale))
                    .append("pt;height:").append((int)(image.height()*scale)).append("pt;\"/>");
                caption(html,image.caption());html.append("</div>");provenance(html,image.provenance());
            }
            case Container container -> { html.append(container.quote() ? "<blockquote>" : "<div>");blocks(html,container.blocks());html.append(container.quote() ? "</blockquote>" : "</div>"); }
            case Code code -> html.append("<pre>").append(escape(code.text())).append("</pre>");
            case Rule ignored -> html.append("<hr/>");
            case Equation equation -> html.append("<pre>").append(escape(equation.source())).append("</pre>");
        }
    }
    private void inlines(StringBuilder html,List<Inline> content) {
        for (Inline inline:content) {
            var tags=new ArrayList<String>();
            if (inline instanceof Text text) for (Style style:Style.values()) if (text.styles().contains(style))
                tags.add(switch (style) { case BOLD -> "strong";case ITALIC -> "em";case UNDERLINE -> "u";case STRIKE -> "s";case CODE -> "code"; });
            tags.forEach(tag -> html.append('<').append(tag).append('>'));
            html.append(escape(ReportText.inline(inline)).replace("\n","<br/>"));
            for (int i=tags.size()-1;i>=0;i--) html.append("</").append(tags.get(i)).append('>');
        }
    }
    private void caption(StringBuilder html,String caption) {
        if (!caption.isBlank()) html.append("<p class=\"caption\">").append(escape(caption)).append("</p>");
    }
    private void provenance(StringBuilder html,AnalysisProvenance p) {
        if (p!=null) html.append("<p class=\"provenance\">").append(escape(ReportText.provenance(p))).append("</p>");
    }
    static String escape(String value) {
        return value.replaceAll("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]", "")
            .replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&apos;");
    }
}

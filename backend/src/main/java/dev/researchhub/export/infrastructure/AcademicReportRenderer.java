package dev.researchhub.export.infrastructure;

import dev.researchhub.export.application.ReportRenderer;
import dev.researchhub.export.domain.ExportFormat;
import dev.researchhub.export.domain.Report;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public final class AcademicReportRenderer implements ReportRenderer {
    private final LatexReportRenderer latex;
    public AcademicReportRenderer(ObjectMapper json) { this.latex=new LatexReportRenderer(json); }
    public byte[] render(Report report,ExportFormat format) {
        return switch (format) {
            case DOCX -> new DocxReportRenderer().render(report);
            case PDF -> new PdfReportRenderer().render(report);
            case LATEX -> latex.render(report);
        };
    }
}

package dev.researchhub.export.infrastructure;

import dev.researchhub.export.application.ReportRenderer;
import dev.researchhub.export.domain.ExportFormat;
import dev.researchhub.export.domain.Report;
import org.springframework.stereotype.Component;

@Component
public final class AcademicReportRenderer implements ReportRenderer {
    public byte[] render(Report report,ExportFormat format) {
        return switch (format) { case DOCX -> new DocxReportRenderer().render(report);case PDF -> new PdfReportRenderer().render(report); };
    }
}

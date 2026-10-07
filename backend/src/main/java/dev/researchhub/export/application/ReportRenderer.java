package dev.researchhub.export.application;

import dev.researchhub.export.domain.ExportFormat;
import dev.researchhub.export.domain.Report;

public interface ReportRenderer {
    byte[] render(Report report,ExportFormat format);
}

-- RH-233: LaTeX source bundles reuse the existing frozen export queue and lifecycle.
ALTER TABLE report_exports DROP CONSTRAINT report_exports_format_check;
ALTER TABLE report_exports ADD CONSTRAINT ck_report_exports_format
    CHECK (format IN ('DOCX', 'PDF', 'LATEX'));

package dev.researchhub.export.domain;

public enum ExportFormat {
    DOCX("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"),
    PDF("application/pdf", "pdf");
    private final String mediaType, extension;
    ExportFormat(String mediaType,String extension) { this.mediaType=mediaType;this.extension=extension; }
    public String mediaType() { return mediaType; }
    public String extension() { return extension; }
}

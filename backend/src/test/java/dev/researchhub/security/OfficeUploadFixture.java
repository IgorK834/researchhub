package dev.researchhub.security;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.zip.*;

public final class OfficeUploadFixture {
    private OfficeUploadFixture() {}
    public static byte[] xlsx() {
        return archive(Map.of("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/></Types>",
                "_rels/.rels", "<Relationships/>", "xl/workbook.xml", "<workbook/>"));
    }
    public static byte[] archive(Map<String, String> entries) {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(output)) {
                for (var entry : entries.entrySet()) {
                    zip.putNextEntry(new ZipEntry(entry.getKey()));
                    zip.write(entry.getValue().getBytes(StandardCharsets.UTF_8));
                    zip.closeEntry();
                }
            }
            return output.toByteArray();
        } catch (IOException impossible) { throw new UncheckedIOException(impossible); }
    }
}

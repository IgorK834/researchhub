package dev.researchhub.security.application;

import dev.researchhub.shared.error.UnsupportedFileTypeException;
import org.springframework.stereotype.Component;
import org.w3c.dom.Element;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;
import org.xml.sax.helpers.DefaultHandler;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Validates bounded staged bytes before storing them. Never extracts ZIP entries or trusts filenames as paths. */
@Component
public class UploadInspector {
    private static final long ZIP_BYTES = 104_857_600;
    private static final int XML_BYTES = 65_536;
    private final List<UploadScanner> scanners;

    public UploadInspector(List<UploadScanner> scanners) { this.scanners = List.copyOf(scanners); }

    public void requireSafe(Path stagedFile, String type) throws IOException {
        if (type.equals("DOCX") || type.equals("XLSX")) inspectOffice(stagedFile, type);
        if (type.equals("TXT") || type.equals("CSV")) inspectText(stagedFile);
        for (UploadScanner scanner : scanners) scanner.requireSafe(stagedFile);
    }

    private static void inspectText(Path file) throws IOException {
        try (InputStream input = Files.newInputStream(file)) {
            byte[] head = input.readNBytes(16);
            String prefix = new String(head, StandardCharsets.ISO_8859_1);
            if (prefix.startsWith("PK") || prefix.startsWith("%PDF-") || prefix.startsWith("MZ")
                    || prefix.startsWith("Rar!") || prefix.startsWith("7z")
                    || (head.length >= 2 && head[0] == 0x1f && head[1] == (byte) 0x8b)
                    || (head.length >= 4 && head[0] == 0x7f && prefix.substring(1).startsWith("ELF"))) {
                throw refused();
            }
        }
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);
        try (Reader reader = new InputStreamReader(Files.newInputStream(file), decoder)) {
            char[] buffer = new char[8192];
            int count;
            while ((count = reader.read(buffer)) != -1) {
                for (int i = 0; i < count; i++) {
                    char c = buffer[i];
                    if (Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t') throw refused();
                }
            }
        } catch (CharacterCodingException invalid) { throw refused(); }
    }

    private static void inspectOffice(Path file, String type) {
        try (ZipFile zip = new ZipFile(file.toFile(), StandardCharsets.UTF_8)) {
            Set<String> names = new HashSet<>();
            long size = 0;
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String name = entry.getName(), lower = name.toLowerCase(Locale.ROOT);
                if (name.length() > 512 || name.startsWith("/") || name.contains("\\") || name.contains(":")
                        || Arrays.asList(name.split("/")).contains("..") || !names.add(name)
                        || names.size() > 10_000 || entry.getSize() < 0
                        || lower.contains("vbaproject") || lower.contains("activex") || lower.contains("macrosheets")) throw refused();
                size += entry.getSize();
                if (size > ZIP_BYTES || (entry.getSize() > 1_048_576
                        && entry.getSize() / Math.max(1, entry.getCompressedSize()) > 200)) throw refused();
            }
            String main = type.equals("DOCX") ? "word/document.xml" : "xl/workbook.xml";
            String contentType = type.equals("DOCX")
                    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
                    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
            if (!names.contains(main) || !names.contains("_rels/.rels") || !names.contains("[Content_Types].xml")) throw refused();
            byte[] xml;
            try (InputStream input = zip.getInputStream(zip.getEntry("[Content_Types].xml"))) {
                xml = input.readNBytes(XML_BYTES + 1);
            }
            if (xml.length > XML_BYTES) throw refused();
            String raw = new String(xml, StandardCharsets.UTF_8).toLowerCase(Locale.ROOT);
            if (raw.contains("macroenabled") || raw.contains("vbaproject")) throw refused();
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            var builder = factory.newDocumentBuilder();
            builder.setErrorHandler(new DefaultHandler() {
                @Override public void fatalError(SAXParseException error) throws SAXException { throw error; }
            });
            var document = builder.parse(new ByteArrayInputStream(xml));
            var overrides = document.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types", "*");
            boolean found = false;
            for (int i = 0; i < overrides.getLength(); i++) {
                Element element = (Element) overrides.item(i);
                String declared = element.getAttribute("ContentType").toLowerCase(Locale.ROOT);
                if (declared.contains("macro") || declared.contains("vba")) throw refused();
                if (element.getLocalName().equals("Override") && element.getAttribute("PartName").equals("/" + main)
                        && element.getAttribute("ContentType").equals(contentType)) found = true;
            }
            if (!found) throw refused();
        } catch (UnsupportedFileTypeException refused) { throw refused;
        } catch (Exception malformed) { throw refused(); }
    }

    private static UnsupportedFileTypeException refused() {
        return new UnsupportedFileTypeException("The file content does not match a supported, macro-free document. Archives are not supported.");
    }
}

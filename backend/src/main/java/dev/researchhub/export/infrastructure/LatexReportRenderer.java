package dev.researchhub.export.infrastructure;

import dev.researchhub.export.application.ReportText;
import dev.researchhub.export.application.TableGrid;
import dev.researchhub.export.domain.Report;
import dev.researchhub.export.domain.Report.*;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import tools.jackson.databind.ObjectMapper;

/** Generates editable UTF-8 sources and local PNG assets. Never invokes a TeX engine or fetches resources. */
public final class LatexReportRenderer {
    private final ObjectMapper json;

    public LatexReportRenderer(ObjectMapper json) { this.json = json; }

    private static final String PREAMBLE = """
        % ResearchHub source export. Compile with XeLaTeX or LuaLaTeX, with shell escape disabled.
        \\documentclass[11pt,a4paper]{article}
        \\usepackage[margin=25mm]{geometry}
        \\usepackage{fontspec}
        \\setmainfont{lmroman10-regular.otf}[BoldFont=lmroman10-bold.otf,ItalicFont=lmroman10-italic.otf,BoldItalicFont=lmroman10-bolditalic.otf]
        \\setmonofont{lmmono10-regular.otf}
        \\usepackage{graphicx,array,longtable}
        \\usepackage[longtable]{multirow}
        \\usepackage{enumitem}
        \\usepackage[normalem]{ulem}
        \\setlistdepth{64}
        \\renewlist{itemize}{itemize}{64}
        \\renewlist{enumerate}{enumerate}{64}
        \\setlist[itemize]{label=\\textbullet,leftmargin=1.5em}
        \\setlist[enumerate]{label=\\arabic*.,leftmargin=2em}
        \\setlength{\\parindent}{0pt}
        \\setlength{\\parskip}{6pt}
        \\setlength{\\emergencystretch}{3em}
        \\author{}
        \\date{}
        """;
    private static final String README = """
        ResearchHub LaTeX source export

        Extract the complete ZIP before editing or compiling.
        report.tex       Editable UTF-8 academic report.
        images/          Embedded, normalized PNG figures; keep their relative paths.
        report.json      Frozen report schema 1.0, including full source and analysis provenance.

        Compile locally with a current TeX Live or MiKTeX installation:
          xelatex -no-shell-escape report.tex
          xelatex -no-shell-escape report.tex
        LuaLaTeX may be used instead. Packages: geometry, fontspec, graphicx, array,
        longtable, multirow, enumitem, ulem, and the Latin Modern OpenType fonts.
        ResearchHub generates sources only and does not compile LaTeX in its backend.

        Citations use the same numeric labels as the exported report. Bibliography
        entries retain immutable source versions. Captions keep the author's text.
        Code and reserved equation nodes are literal text; edit them in report.tex
        to add your own mathematical typesetting. User text is escaped throughout.
        """;

    public byte[] render(Report report) {
        var writer = new Writer();
        var tex = new StringBuilder(PREAMBLE);
        tex.append("\\title{").append(escape(report.title())).append("}\n\\begin{document}\n\\maketitle\n");
        tex.append("{\\small Document revision ").append(report.revision()).append("; captured at ")
            .append(escape(report.capturedAt().toString())).append(".}\\par\n");
        writer.blocks(tex, report.blocks(), false);
        if (!report.bibliography().isEmpty()) {
            tex.append("\\section*{References}\n");
            for (var entry : report.bibliography()) tex.append("{\\raggedright ")
                .append(escape(ReportText.bibliography(entry))).append("\\par}\n");
        }
        if (!report.warnings().isEmpty()) {
            tex.append("\\section*{Export notes}\n\\begin{itemize}\n");
            for (var warning : report.warnings()) tex.append("\\item ").append(escape(warning)).append('\n');
            tex.append("\\end{itemize}\n");
        }
        tex.append("\\end{document}\n");
        try (var bytes = new ByteArrayOutputStream(); var zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            add(zip, "report.tex", tex.toString().getBytes(StandardCharsets.UTF_8));
            add(zip, "README.txt", README.getBytes(StandardCharsets.UTF_8));
            add(zip, "report.json", json.writeValueAsBytes(report));
            for (var asset : writer.assets.entrySet()) add(zip, asset.getKey(), asset.getValue());
            zip.finish();
            return bytes.toByteArray();
        } catch (IOException failed) {
            throw new IllegalStateException("LaTeX bundle cannot be written", failed);
        }
    }

    private static void add(ZipOutputStream zip, String name, byte[] bytes) throws IOException {
        var entry = new ZipEntry(name);
        entry.setTime(0); // Stable ZIP metadata does not introduce wall-clock time into the artifact.
        zip.putNextEntry(entry);
        zip.write(bytes);
        zip.closeEntry();
    }

    /** Character-by-character escaping avoids reinterpreting generated escapes or using unsafe verbatim delimiters. */
    private static String escape(String text) {
        var result = new StringBuilder();
        text.replace("\r\n", "\n").replace('\r', '\n').codePoints().forEach(c -> {
            result.append(switch (c) {
                case '\\' -> "\\textbackslash{}";
                case '{' -> "\\{";
                case '}' -> "\\}";
                case '$' -> "\\$";
                case '&' -> "\\&";
                case '#' -> "\\#";
                case '%' -> "\\%";
                case '_' -> "\\_";
                case '~' -> "\\textasciitilde{}";
                case '^' -> "\\textasciicircum{}";
                case '\n', 0x2028, 0x2029 -> "\\newline{}\n";
                case '\t' -> "    ";
                default -> Character.isISOControl(c) ? "" : new String(Character.toChars(c));
            });
        });
        return result.toString();
    }

    private static final class Writer {
        private final Map<String, byte[]> assets = new LinkedHashMap<>();
        private final Map<String, String> imageNames = new HashMap<>();

        void blocks(StringBuilder out, List<Block> blocks, boolean insideCell) {
            for (var block : blocks) {
                switch (block) {
                    case Paragraph p -> {
                        if (p.caption()) out.append("{\\small\\itshape ");
                        out.append(inlines(p.content()));
                        if (p.caption()) out.append('}');
                        out.append("\\par\n");
                    }
                    case Heading h -> {
                        String command = switch (h.level()) {
                            case 1 -> "section";
                            case 2 -> "subsection";
                            case 3 -> "subsubsection";
                            case 4 -> "paragraph";
                            case 5 -> "subparagraph";
                            default -> null;
                        };
                        if (command == null) out.append("{\\bfseries ").append(inlines(h.content())).append("}\\par\n");
                        else out.append('\\').append(command).append("*{").append(inlines(h.content())).append("}\n");
                    }
                    case ListBlock list -> {
                        String environment = list.ordered() ? "enumerate" : "itemize";
                        out.append("\\begin{").append(environment).append('}');
                        if (list.ordered()) out.append("[start=").append(list.start()).append(']');
                        out.append('\n');
                        // Empty editor lists remain syntactically valid without creating fictitious content.
                        if (list.items().isEmpty()) out.append("\\item[]\n");
                        for (var item : list.items()) { out.append("\\item "); blocks(out, item, insideCell); }
                        out.append("\\end{").append(environment).append("}\n");
                    }
                    case Table table -> table(out, table, insideCell);
                    case Image image -> {
                        String name = imageNames.computeIfAbsent(image.pngBase64(), encoded -> {
                            String path = String.format(Locale.ROOT, "images/figure-%03d.png", assets.size() + 1);
                            assets.put(path, Base64.getDecoder().decode(encoded));
                            return path;
                        });
                        out.append("\\begin{center}\n\\includegraphics[width=\\linewidth,height=0.72\\textheight,keepaspectratio]{")
                            .append(name).append("}\n\\end{center}\n");
                        caption(out, image.caption().isBlank() ? image.alt() : image.caption());
                        caption(out, ReportText.provenance(image.provenance()));
                    }
                    case Container container -> {
                        if (container.quote()) out.append("\\begin{quote}\n");
                        blocks(out, container.blocks(), insideCell);
                        if (container.quote()) out.append("\\end{quote}\n");
                    }
                    case Code code -> literal(out, code.text());
                    case Rule ignored -> out.append("\\par\\noindent\\rule{\\linewidth}{0.4pt}\\par\n");
                    case Equation equation -> {
                        caption(out, "Equation (" + equation.notation() + " source)");
                        literal(out, equation.source());
                    }
                }
            }
        }

        private static String inlines(List<Inline> content) {
            var out = new StringBuilder();
            for (var inline : content) {
                if (inline instanceof Citation citation) { out.append(escape(ReportText.citation(citation))); continue; }
                var text = (Text) inline;
                String value = escape(text.text());
                // A fixed nesting order keeps output reproducible across immutable Set implementations.
                for (var style : Style.values()) if (text.styles().contains(style)) {
                    String command = switch (style) {
                        case BOLD -> "textbf";
                        case ITALIC -> "emph";
                        case UNDERLINE -> "uline";
                        case STRIKE -> "sout";
                        case CODE -> "texttt";
                    };
                    value = "\\" + command + "{" + value + "}";
                }
                out.append(value);
            }
            return out.toString();
        }

        private static void literal(StringBuilder out, String text) {
            out.append("{\\ttfamily ").append(escape(text).replace(" ", "\\ \\allowbreak{}")).append("}\\par\n");
        }

        private static void caption(StringBuilder out, String text) {
            if (!text.isBlank()) out.append("{\\small\\itshape ").append(escape(text)).append("}\\par\n");
        }

        private void table(StringBuilder out, Table table, boolean nested) {
            var grid = TableGrid.of(table);
            String environment = nested ? "tabular" : "longtable";
            out.append("\\begin{").append(environment).append("}{");
            for (int c = 0; c < grid.columns(); c++) out.append(column(1, grid.columns()));
            out.append("}\n\\hline\n");
            int headerRows = 0;
            if (!nested) while (headerRows < table.rows().size()
                && table.rows().get(headerRows).stream().allMatch(cell -> cell.header() && cell.rowspan() == 1)) headerRows++;
            if (headerRows == table.rows().size()) headerRows = 0;
            int protectedUntil = -1;
            for (int r = 0; r < grid.rows().size(); r++) {
                var row = grid.rows().get(r);
                for (int c = 0; c < grid.columns();) {
                    if (c > 0) out.append(" & ");
                    var slot = row.get(c);
                    var cell = slot.cell();
                    if (!slot.continuation()) protectedUntil = Math.max(protectedUntil, r + cell.rowspan() - 1);
                    if (cell.colspan() > 1) out.append("\\multicolumn{").append(cell.colspan()).append("}{")
                        .append(column(cell.colspan(), grid.columns())).append("}{");
                    if (!slot.continuation()) {
                        if (cell.rowspan() > 1) out.append("\\multirow[t]{").append(cell.rowspan()).append("}{=}{");
                        out.append("\\begin{minipage}[t]{\\linewidth}\\vspace{0pt}\n");
                        if (cell.header()) out.append("{\\bfseries ");
                        blocks(out, cell.blocks(), true);
                        if (cell.header()) out.append('}');
                        out.append("\\end{minipage}");
                        if (cell.rowspan() > 1) out.append('}');
                    }
                    if (cell.colspan() > 1) out.append('}');
                    c += cell.colspan();
                }
                out.append(r < protectedUntil ? " \\\\*\n" : " \\\\ \\hline\n");
                if (r + 1 == headerRows) out.append("\\endhead\n");
            }
            out.append("\\end{").append(environment).append("}\n\\par\n");
            caption(out, table.caption());
            caption(out, ReportText.provenance(table.provenance()));
        }

        private static String column(int span, int columns) {
            return ">{\\raggedright\\arraybackslash}p{\\dimexpr\\linewidth*" + span + "/" + columns + "-2\\tabcolsep\\relax}";
        }
    }
}

package dev.researchhub.source.application;

import dev.researchhub.source.application.BibliographyImportContracts.Format;
import dev.researchhub.source.application.BibliographyImportContracts.ParsedBatch;

/** Local parser port. Implementations must not resolve URLs, paths, macros, or LaTeX commands. */
public interface BibliographyParser {
    ParsedBatch parse(Format format, byte[] utf8File);
}

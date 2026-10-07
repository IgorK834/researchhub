"""Text-native PDF extraction; no OCR or invented page geometry."""
from io import BytesIO
from pypdf import PdfReader
from ..contracts import PageStructure, UnitLocation
from .common import ParseFailure, TextBuilder

PARSER_VERSION = 'pypdf-6.19.0/rh-1'


def _has_image(resources, seen=None):
    seen = set() if seen is None else seen
    resources = resources.get_object() if hasattr(resources, 'get_object') else resources
    objects = resources.get('/XObject', {}) if resources else {}
    objects = objects.get_object() if hasattr(objects, 'get_object') else objects
    for reference in objects.values():
        obj = reference.get_object()
        identity = id(obj)
        if identity in seen:
            continue
        seen.add(identity)
        if obj.get('/Subtype') == '/Image':
            return True
        if obj.get('/Subtype') == '/Form' and _has_image(obj.get('/Resources', {}), seen):
            return True
    return False


def parse_pdf(data, source_id, limits):
    reader = PdfReader(BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ParseFailure('PDF_ENCRYPTED', 'Password-protected PDFs are not supported.')
    if len(reader.pages) > limits.max_pages:
        raise ParseFailure('EXTRACTION_LIMIT_EXCEEDED', 'The PDF exceeds the configured page limit.')
    builder = TextBuilder(source_id, PARSER_VERSION, limits)
    pages, scanned = [], []
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ''
        start, end = builder.add(text, UnitLocation(kind='PDF_PAGE'), page_number=number)
        pages.append(PageStructure(page_number=number, character_start=start, character_end=end))
        if not text.strip() and _has_image(page.get('/Resources', {})):
            scanned.append(number)
    if builder.position == 0:
        if scanned:
            raise ParseFailure('OCR_REQUIRED', 'This image-only PDF requires OCR. Cloud OCR is not configured.')
        raise ParseFailure('EMPTY_DOCUMENT', 'The PDF contains no extractable text.')
    warnings = []
    if scanned:
        warnings.append('OCR_REQUIRED: Some image-only pages have no extracted text; page numbers are preserved.')
    metadata = reader.metadata
    title = str(metadata.title).replace('\x00', '')[:500] if metadata and metadata.title else None
    author = str(metadata.author).replace('\x00', '')[:500] if metadata and metadata.author else None
    return builder, pages, [], None, warnings, title, author

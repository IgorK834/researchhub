"""Body blocks in document order, with logical block/section provenance."""
from io import BytesIO
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from ..contracts import SectionStructure, UnitLocation
from .common import ParseFailure, TextBuilder, check_office_archive

PARSER_VERSION = 'python-docx-1.2.0/rh-1'


def _heading_level(paragraph):
    style = paragraph.style
    while style is not None:
        if style.style_id.startswith('Heading') and style.style_id[7:].isdigit():
            return min(int(style.style_id[7:]), 20)
        style = style.base_style
    return None


def _table_text(table):
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            cells.append('\n'.join(block.text if isinstance(block, Paragraph) else _table_text(block)
                                   for block in cell.iter_inner_content()))
        rows.append('\t'.join(cells))
    return '\n'.join(rows)


def parse_docx(data, source_id, limits):
    check_office_archive(data, limits)
    document = Document(BytesIO(data))
    builder = TextBuilder(source_id, PARSER_VERSION, limits)
    sections, stack = [], []
    for index, block in enumerate(document.iter_inner_content()):
        level = _heading_level(block) if isinstance(block, Paragraph) else None
        text = _table_text(block) if isinstance(block, Table) else block.text
        if not text.strip():
            continue
        if level:
            while stack and sections[stack[-1]].level >= level:
                position = stack.pop()
                sections[position] = sections[position].model_copy(update={'character_end': builder.position})
            section_id = f'section-{index}'
            sections.append(SectionStructure(section_id=section_id, heading=text[:500], level=level,
                parent_section_id=sections[stack[-1]].section_id if stack else None,
                character_start=builder.position, character_end=builder.position))
            stack.append(len(sections)-1)
        section_id = sections[stack[-1]].section_id if stack else None
        kind = 'HEADING' if level else ('TABLE' if isinstance(block, Table) else 'PARAGRAPH')
        builder.add(text, UnitLocation(kind=kind, block_index=index, heading_level=level), section_id=section_id)
    for position in stack:
        sections[position] = sections[position].model_copy(update={'character_end': builder.position})
    if builder.position == 0:
        raise ParseFailure('EMPTY_DOCUMENT', 'The DOCX contains no extractable body text.')
    properties = document.core_properties
    return builder, [], sections, None, [], properties.title[:500] or None, properties.author[:500] or None

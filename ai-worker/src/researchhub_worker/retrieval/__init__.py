"""Deterministic structure-first chunking. Windows and offsets count Unicode code points."""
from .contracts import ChunkingConfig, RetrievalChunk, RetrievalChunkSet, SourceSpan, digest, identity_digest


def _scope(unit):
    return (unit.page_number, unit.section_id, unit.location.sheet_name if unit.location else None)


def _descendant(section, ancestor, sections):
    while section in sections:
        if section == ancestor:
            return True
        section = sections[section].parent_section_id
    return False


def _groups(units, sections):
    group = []
    for unit in units:
        if not unit.text.strip():
            continue
        if group and _scope(unit) != _scope(group[-1]):
            # An otherwise isolated parent heading belongs with its first descendant's body.
            headings_only = all(item.location and item.location.kind == 'HEADING' for item in group)
            same_page_sheet = (_scope(unit)[0], _scope(unit)[2]) == (_scope(group[-1])[0], _scope(group[-1])[2])
            if not (headings_only and same_page_sheet and _descendant(unit.section_id, group[-1].section_id, sections)):
                yield group
                group = []
        group.append(unit)
    if group:
        yield group


def _windows(text, config, body_start=0):
    start = 0
    while start < len(text):
        end = min(start + config.max_characters, len(text))
        if end < len(text):
            # Rebalance a tiny final window while keeping both the size cap and overlap.
            if len(text) - (end - config.overlap_characters) < config.min_characters:
                end = len(text) - config.min_characters + config.overlap_characters
            for boundary in ('\n\n', '\n', ' '):
                found = text.rfind(boundary, start + config.min_characters, end)
                if found >= 0 and not (start < body_start and found <= body_start < end):
                    end = found
                    break
        yield start, end
        if end == len(text):
            break
        start = max(start + 1, end - config.overlap_characters)


def chunk_extraction(result, config=None):
    config = config or ChunkingConfig.from_env()
    sections = {section.section_id: section for section in result.structure.sections}
    extraction_hash = digest(''.join(unit.text for unit in result.chunks))
    version = 'retrieval-1:' + identity_digest([result.processing_version, result.parser_version,
        result.extraction_metadata.content_sha256, extraction_hash, config.version,
        config.max_characters, config.overlap_characters, config.min_characters])
    chunks = []
    for group in _groups(result.chunks, sections):
        parts, offsets, position = [], [], 0
        for unit in group:
            if parts:
                position += 2
            offsets.append((position, position + len(unit.text), unit))
            parts.append(unit.text)
            position += len(unit.text)
        text = '\n\n'.join(parts)
        body_start = next((left for left, _right, unit in offsets if not unit.location or unit.location.kind != 'HEADING'), 0)
        for start, end in _windows(text, config, body_start):
            spans, pieces, pages = [], [], []
            # Synthetic separators are not source text; trimming is reflected in source spans.
            while start < end and text[start].isspace(): start += 1
            while end > start and text[end-1].isspace(): end -= 1
            for left, right, unit in offsets:
                first, last = max(start, left), min(end, right)
                if first < last:
                    spans.append(SourceSpan(unit_id=unit.chunk_id,
                        character_start=unit.character_start + first-left,
                        character_end=unit.character_start + last-left))
                    pieces.append(unit.text[first-left:last-left])
                    last_unit = unit
                    if unit.page_number is not None: pages.append(unit.page_number)
            content = '\n\n'.join(pieces)
            if not content.strip(): continue
            title = sections[last_unit.section_id].heading if last_unit.section_id in sections else None
            index, content_hash = len(chunks), digest(content)
            chunk_id = identity_digest([str(result.workspace_id), str(result.source_id), None, version,
                index, content_hash, [[s.unit_id, s.character_start, s.character_end] for s in spans]])
            chunks.append(RetrievalChunk(chunk_id=chunk_id, source_id=result.source_id,
                workspace_id=result.workspace_id, source_version_id=None, chunk_index=index,
                content=content, page_start=min(pages) if pages else None, page_end=max(pages) if pages else None,
                section_title=title, content_hash=content_hash, processing_version=version, spans=spans))
            if len(chunks) > 10000:
                raise ValueError('Retrieval exceeds the chunk count limit')
    return RetrievalChunkSet(source_id=result.source_id, workspace_id=result.workspace_id, source_version_id=None,
        ingestion_version=result.processing_version, parser_version=result.parser_version,
        source_content_hash=result.extraction_metadata.content_sha256, extraction_content_hash=extraction_hash,
        processing_version=version, config=config, chunks=chunks)

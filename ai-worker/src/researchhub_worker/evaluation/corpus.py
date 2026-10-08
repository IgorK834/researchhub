"""Read-only, content-pinned corpus using the real worker parsers and chunker."""
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid5

from ..contracts import SourceIngestCommand, SourceIngestResult
from ..parsing import SourceParser
from ..parsing.common import ParserLimits
from ..retrieval import chunk_extraction
from ..retrieval.contracts import ChunkingConfig, digest, identity_digest
from .contracts import Suite


@dataclass(frozen=True)
class LoadedSuite:
    suite: Suite
    root: Path
    extractions: dict
    suite_hash: str
    corpus_hash: str

    def chunks(self, config):
        return [chunk for source in self.suite.sources
                for chunk in chunk_extraction(self.extractions[source.id], config).chunks]


def source_path(root, source):
    path = (root / source.path).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError('Corpus file outside suite directory or missing')
    return path


def parse_source(source, data, config):
    command = SourceIngestCommand(schema_version='4.0', job_id=uuid5(source.id, 'evaluation-ingest'),
        workspace_id=source.workspace_fixture_id, source_id=source.id, source_type=source.source_type,
        file_access={'kind': 'SIGNED_URL', 'url': 'https://fixture.invalid/unused', 'expiresAt': '2099-01-01T00:00:00Z'},
        requested_processing_version='source-ingest-4', attempt=1)
    # No host chunking/parser env settings can silently alter the fixed corpus.
    parser = SourceParser(limits=ParserLimits(), downloader=lambda *_: data, chunking=config)
    result = parser(command)
    if result.status != 'SUCCEEDED':
        raise ValueError('Evaluation corpus parsing failed')
    return result


def load_suite(path: Path) -> LoadedSuite:
    raw = Path(path).read_text(encoding='utf-8')
    suite = Suite.model_validate_json(raw)
    root, extractions = Path(path).resolve().parent, {}
    for source in suite.sources:
        data = source_path(root, source).read_bytes()
        if digest_bytes(data) != source.sha256:
            raise ValueError('Corpus content hash mismatch')
        result = parse_source(source, data, suite.reference_chunking)
        if digest(''.join(unit.text for unit in result.chunks)) != source.extraction_sha256:
            raise ValueError('Corpus extraction hash mismatch; version the suite before changing parsers')
        extractions[source.id] = result
    for case in suite.cases:
        for fact in case.expected_facts:
            for location in fact.locations:
                result: SourceIngestResult = extractions[location.source_id]
                unit = next((u for u in result.chunks if u.chunk_id == location.unit_id), None)
                if (unit is None or unit.page_number != location.page
                        or not unit.character_start <= location.character_start < location.character_end <= unit.character_end):
                    raise ValueError('Gold location does not exist in fixed corpus')
                matches = [c.chunk_id for c in result.retrieval.chunks if covers(c, location)]
                if not matches or location.chunk_ids and not set(location.chunk_ids) <= set(matches):
                    raise ValueError('Gold reference chunk does not cover expected span')
    return LoadedSuite(suite, root, extractions, digest(suite.model_dump_json(by_alias=True)),
        identity_digest([[str(s.id), str(s.workspace_fixture_id), s.sha256, s.extraction_sha256] for s in suite.sources]))


def digest_bytes(data):
    import hashlib
    return hashlib.sha256(data).hexdigest()


def covers(chunk, location):
    """A gold passage requires its entire span, not any overlap that happens to hit it."""
    return chunk.source_id == location.source_id and (location.page is None or
        chunk.page_start is not None and chunk.page_start <= location.page <= chunk.page_end) and any(
        span.unit_id == location.unit_id and span.character_start <= location.character_start
        and span.character_end >= location.character_end for span in chunk.spans)

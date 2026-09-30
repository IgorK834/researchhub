"""Bounded parser output and shared OOXML checks. Offsets count Unicode code points."""
from dataclasses import dataclass
from io import BytesIO
import os
from uuid import UUID
from zipfile import ZipFile

from ..contracts import ExtractedChunk, UnitLocation


class ParseFailure(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ParserLimits:
    max_file_bytes: int = 52_428_800
    max_characters: int = 500_000
    max_units: int = 10_000
    max_pages: int = 2_000
    xlsx_rows: int = 1_000
    xlsx_columns: int = 64
    xlsx_samples: int = 10
    max_sheets: int = 100
    max_zip_bytes: int = 104_857_600

    @classmethod
    def from_env(cls):
        values = {}
        ceilings = {'xlsx_rows': 10000, 'xlsx_columns': 256, 'xlsx_samples': 100,
                    'max_sheets': 100, 'max_pages': 10000, 'max_units': 10000,
                    'max_characters': 500000, 'max_file_bytes': 52428800,
                    'max_zip_bytes': 104857600}
        for field, ceiling in ceilings.items():
            raw = os.getenv('AI_WORKER_' + field.upper())
            if raw is not None:
                value = int(raw)
                if not 1 <= value <= ceiling:
                    raise ValueError('Invalid parser limit: ' + field)
                values[field] = value
        return cls(**values)


class TextBuilder:
    def __init__(self, source_id: UUID, version: str, limits: ParserLimits):
        self.source_id = source_id
        self.version = version
        self.limits = limits
        self.chunks: list[ExtractedChunk] = []
        self.position = 0

    def add(self, text: str, location: UnitLocation, page_number=None, section_id=None):
        text = text.replace('\x00', '').strip()
        if len(text) > 250_000 or self.position + len(text) > self.limits.max_characters or len(self.chunks) >= self.limits.max_units:
            raise ParseFailure('EXTRACTION_LIMIT_EXCEEDED', 'The document exceeds configured extraction limits.')
        start = self.position
        self.position += len(text)
        self.chunks.append(ExtractedChunk(source_id=self.source_id, parser_version=self.version,
            chunk_id=f'unit-{len(self.chunks)}', ordinal=len(self.chunks), text=text,
            page_number=page_number, section_id=section_id, character_start=start,
            character_end=self.position, location=location))
        return start, self.position


def check_office_archive(data: bytes, limits: ParserLimits):
    with ZipFile(BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(entry.file_size for entry in entries) > limits.max_zip_bytes:
            raise ParseFailure('EXTRACTION_LIMIT_EXCEEDED', 'The Office archive exceeds configured extraction limits.')
        if any('vbaproject' in entry.filename.lower() for entry in entries) or b'macroEnabled' in archive.read('[Content_Types].xml'):
            raise ParseFailure('UNSUPPORTED_MACROS', 'Macro-enabled Office files are not supported.')

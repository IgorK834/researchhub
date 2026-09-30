"""Retrieval v1: code-point spans, stable IDs, mandatory workspace and explicit configuration."""
from typing import Annotated, Literal
from uuid import UUID
import hashlib
import json
import os
from pydantic import Field, StrictInt, StringConstraints, model_validator
from ..contract_model import ContractModel

Hash = Annotated[str, StringConstraints(pattern=r'^[0-9a-f]{64}$')]
Version = Annotated[str, StringConstraints(min_length=1, max_length=128)]
CHUNKING_VERSION = 'hierarchical-char-1'


def digest(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def identity_digest(values: list) -> str:
    return digest(json.dumps(values, ensure_ascii=False, separators=(',', ':')))


class ChunkingConfig(ContractModel):
    version: Literal[CHUNKING_VERSION] = CHUNKING_VERSION
    max_characters: Annotated[StrictInt, Field(ge=32, le=8000)] = 1600
    overlap_characters: Annotated[StrictInt, Field(ge=0)] = 150
    min_characters: Annotated[StrictInt, Field(ge=1)] = 200

    @model_validator(mode='after')
    def bounded_overlap(self):
        if self.overlap_characters > self.max_characters // 2 or self.min_characters > self.max_characters - self.overlap_characters:
            raise ValueError('Invalid chunking size/overlap/minimum combination')
        return self

    @classmethod
    def from_env(cls):
        fields = ('max_characters', 'overlap_characters', 'min_characters')
        return cls(**{name: int(os.environ['AI_WORKER_CHUNK_' + name.upper()])
                     for name in fields if 'AI_WORKER_CHUNK_' + name.upper() in os.environ})


class SourceSpan(ContractModel):
    unit_id: Version
    character_start: Annotated[StrictInt, Field(ge=0)]
    character_end: Annotated[StrictInt, Field(ge=1)]

    @model_validator(mode='after')
    def ordered_range(self):
        if self.character_end <= self.character_start:
            raise ValueError('Retrieval span must contain source text')
        return self


class RetrievalChunk(ContractModel):
    chunk_id: Hash
    source_id: UUID
    workspace_id: UUID
    source_version_id: UUID | None
    chunk_index: Annotated[StrictInt, Field(ge=0)]
    content: Annotated[str, StringConstraints(min_length=1, max_length=8000)]
    page_start: Annotated[StrictInt, Field(ge=1)] | None
    page_end: Annotated[StrictInt, Field(ge=1)] | None
    section_title: Annotated[str, StringConstraints(max_length=500)] | None
    content_hash: Hash
    processing_version: Version
    spans: Annotated[list[SourceSpan], Field(min_length=1, max_length=10000)]

    @model_validator(mode='after')
    def valid_provenance(self):
        if (self.page_start is None) != (self.page_end is None) or (self.page_start is not None and self.page_end < self.page_start):
            raise ValueError('Invalid retrieval page range')
        if self.content_hash != digest(self.content):
            raise ValueError('Invalid retrieval content hash')
        return self

    def search_document(self):
        """Exact v1 search projection. A later search adapter must retain workspace/version filters."""
        return self.model_dump(mode='json', by_alias=True)


class RetrievalChunkSet(ContractModel):
    schema_version: Literal['1.0'] = '1.0'
    source_id: UUID
    workspace_id: UUID
    source_version_id: UUID | None
    ingestion_version: Version
    parser_version: Version
    source_content_hash: Hash
    extraction_content_hash: Hash
    processing_version: Version
    config: ChunkingConfig
    chunks: Annotated[list[RetrievalChunk], Field(max_length=10000)]

    def expected_version(self):
        return 'retrieval-1:' + identity_digest([self.ingestion_version, self.parser_version,
            self.source_content_hash, self.extraction_content_hash, self.config.version,
            self.config.max_characters, self.config.overlap_characters, self.config.min_characters])

    @model_validator(mode='after')
    def versioned_identity(self):
        if self.processing_version != self.expected_version():
            raise ValueError('Invalid retrieval processing version')
        ids = set()
        for index, chunk in enumerate(self.chunks):
            if (chunk.workspace_id, chunk.source_id, chunk.source_version_id, chunk.processing_version, chunk.chunk_index) != (self.workspace_id, self.source_id, self.source_version_id, self.processing_version, index):
                raise ValueError('Retrieval identity/version mismatch')
            if len(chunk.content) > self.config.max_characters:
                raise ValueError('Retrieval content exceeds configured limit')
            expected = identity_digest([str(self.workspace_id), str(self.source_id),
                str(self.source_version_id) if self.source_version_id else None, self.processing_version,
                index, chunk.content_hash, [[s.unit_id, s.character_start, s.character_end] for s in chunk.spans]])
            if chunk.chunk_id != expected or chunk.chunk_id in ids:
                raise ValueError('Invalid retrieval chunk identity')
            ids.add(chunk.chunk_id)
        return self

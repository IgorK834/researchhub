"""Offline fixture adapters. This index is deliberately not PostgreSQL/pgvector."""
import json
import re
from uuid import uuid5

from ..ai.context import FRAMING_RESERVE, ContextualRequest
from ..ai.contracts import Evidence, GenerationRequest
from ..ai.providers import FakeModelProvider, ModelGateway
from ..ai.telemetry import invoke
from ..retrieval.contracts import digest
from ..retrieval.embeddings import FakeEmbeddingProvider
from .contracts import AnswerObservation, RetrievalDiagnostic


def contextual_request(case, chunks, config):
    request = GenerationRequest(schema_version='1.0', request_id=uuid5(case.workspace_fixture_id, case.id),
        template_id=config.template_id, template_hash=digest(config.system_instruction),
        system_instruction=config.system_instruction, instruction=case.question, parameters=config.parameters,
        evidence=[Evidence(chunk_id=c.chunk_id, content_hash=c.content_hash, content=c.content) for c in chunks])
    bindings, lines = [], []
    for index, chunk in enumerate(chunks, 1):
        key = f'S{index}'
        bindings.append({'citationKey': key, 'chunkId': chunk.chunk_id, 'textReference': None})
        lines.extend([f'[{key}]', json.dumps({'chunkId': chunk.chunk_id, 'sourceId': str(chunk.source_id),
            'title': 'Evaluation fixture', 'pageStart': chunk.page_start, 'pageEnd': chunk.page_end,
            'sectionTitle': chunk.section_title, 'processingVersion': chunk.processing_version,
            'spans': [s.model_dump(by_alias=True) for s in chunk.spans], 'text': chunk.content,
            'textReference': None}, ensure_ascii=False, separators=(',', ':'))])
    text = '\n'.join(lines)
    user = json.dumps({'instruction': case.question, 'context': text}, ensure_ascii=False, separators=(',', ':'))
    tokens = len(config.system_instruction.encode()) + len(user.encode()) + FRAMING_RESERVE + config.parameters.max_output_tokens
    return ContextualRequest.model_validate({'schemaVersion': '2.0', 'request': request.model_dump(),
        'context': {'text': text, 'summary': {'builderVersion': '1.0', 'tokenPolicy': 'utf8-conservative-v1',
            'budget': {'maxTokens': 131072, 'maxBytes': 131072, 'collapseExactDuplicates': False},
            'contextHash': digest(text), 'contextBytes': len(text.encode()), 'tokenUpperBound': tokens,
            'citations': bindings}}})


class OfflineBackend:
    def __init__(self, loaded, config, gateway=None):
        if not config.index.startswith('fixture-'):
            raise ValueError('Offline evaluation requires a fixture index')
        self.config = config
        self.chunks = loaded.chunks(config.chunking)
        embeddings = FakeEmbeddingProvider()
        vectors = embeddings.embed_documents([c.content for c in self.chunks]).vectors
        self.vectors = {c.chunk_id: v for c, v in zip(self.chunks, vectors)}
        self.embeddings = embeddings
        self.gateway = gateway or ModelGateway(FakeModelProvider())
        self._diagnostics = []

    def metadata(self):
        return {'adapter': self.config.index, 'productionIndex': False,
            'embedding': self.embeddings.model_metadata().model_dump(mode='json', by_alias=True),
            'model': self.gateway.model_metadata().model_dump(mode='json', by_alias=True),
            'templateId': self.config.template_id, 'templateHash': digest(self.config.system_instruction)}

    def retrieve(self, case):
        scoped = [c for c in self.chunks if c.workspace_id == case.workspace_fixture_id and
            (case.selected_source_ids is None or c.source_id in case.selected_source_ids)]
        terms = set(re.findall(r'\w+', case.question.casefold()))
        query = self.embeddings.embed_query(case.question).vectors[0]
        vector = sorted(scoped, key=lambda c: (-sum(a*b for a, b in zip(query, self.vectors[c.chunk_id])), c.chunk_id))
        # Explicit offline lexical proxy; PostgreSQL uses ts_rank_cd/plainto_tsquery.
        lexical = sorted([c for c in scoped if terms & set(re.findall(r'\w+', c.content.casefold()))],
            key=lambda c: (-len(terms & set(re.findall(r'\w+', c.content.casefold()))), c.chunk_id))
        ranks = [lexical] if self.config.index == 'fixture-lexical' else [vector] if self.config.index == 'fixture-vector' else [vector, lexical]
        scores = {}
        for ranking in ranks:
            for rank, chunk in enumerate(ranking[:self.config.top_k * 10], 1):
                scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0) + 1 / (60 + rank)
        result = sorted([c for c in scoped if c.chunk_id in scores], key=lambda c: (-scores[c.chunk_id], c.chunk_id))[:self.config.top_k]
        self._diagnostics = [RetrievalDiagnostic(rank=rank, chunk_id=c.chunk_id, score=scores[c.chunk_id],
            vector_similarity=sum(a*b for a, b in zip(query, self.vectors[c.chunk_id])),
            lexical_score=len(terms & set(re.findall(r'\w+', c.content.casefold()))),
            embedding_model=self.embeddings.model_metadata()) for rank, c in enumerate(result, 1)]
        return result

    def retrieval_diagnostics(self):
        return self._diagnostics

    def answer(self, case, chunks):
        request = contextual_request(case, chunks, self.config)
        result = invoke(self.gateway, self.gateway.generate_structured, request)
        return AnswerObservation(answer=result.answer, provided_chunks=chunks, usage=result.usage,
            model={'provider': result.model.provider, 'name': result.model.name, 'version': result.model.version},
            template_id=result.template_id, template_hash=result.template_hash, latency_ms=0)

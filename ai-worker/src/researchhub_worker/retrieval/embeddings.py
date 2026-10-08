"""Vendor-neutral embeddings. Only adapters know provider HTTP contracts."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
import re
import time
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from pydantic import Field, model_validator
from ..contract_model import ContractModel


class ModelMetadata(ContractModel):
    provider: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    version: str = Field(min_length=1, max_length=128)
    dimension: int = Field(strict=True, ge=1, le=4096)


class EmbeddingBatch(ContractModel):
    metadata: ModelMetadata
    vectors: list[list[float]]

    @model_validator(mode='after')
    def valid_vectors(self):
        for vector in self.vectors:
            if len(vector) != self.metadata.dimension or not all(math.isfinite(v) for v in vector) or not any(vector):
                raise ValueError('Invalid embedding vector')
        return self


class EmbeddingError(RuntimeError):
    """Safe provider failure; transient failures alone are eligible for retry."""
    def __init__(self, transient=False):
        super().__init__('Embedding provider could not complete the request')
        self.transient = transient


class EmbeddingProvider(Protocol):
    def embed_documents(self, texts: list[str]) -> EmbeddingBatch: ...
    def embed_query(self, text: str) -> EmbeddingBatch: ...
    def model_metadata(self) -> ModelMetadata: ...


class FakeEmbeddingProvider:
    """Stable token hashing for tests/offline use, not production semantic inference."""
    def model_metadata(self):
        return ModelMetadata(provider='deterministic', name='token-hash', version='1', dimension=32)

    def embed_documents(self, texts):
        vectors = []
        for text in texts:
            vector = [0.0] * 32
            for token in re.findall(r'\w+', text.casefold()) or [text]:
                vector[int.from_bytes(hashlib.sha256(token.encode()).digest()[:4], 'big') % 32] += 1
            norm = math.sqrt(sum(value * value for value in vector))
            vectors.append([value / norm for value in vector])
        return EmbeddingBatch(metadata=self.model_metadata(), vectors=vectors)

    def embed_query(self, text):
        return self.embed_documents([text])


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class AzureEmbeddingProvider:
    """Pinned Azure v1 REST adapter; model version is a deployment contract."""
    def __init__(self, endpoint, api_key, deployment, metadata, opener=None):
        parts = urlsplit(endpoint)
        if parts.scheme != 'https' or not parts.netloc or parts.username or parts.query or parts.fragment or parts.path not in ('', '/'):
            raise ValueError('Azure embedding endpoint must be an HTTPS origin')
        if not api_key or not deployment or metadata.provider != 'azure':
            raise ValueError('Azure embedding credentials/deployment/metadata are required')
        self._url = endpoint.rstrip('/') + '/openai/v1/embeddings?api-version=v1'
        self._api_key, self._deployment, self._metadata = api_key, deployment, metadata
        self._opener = opener or build_opener(_NoRedirect)

    def model_metadata(self):
        return self._metadata

    def embed_documents(self, texts):
        request = Request(self._url, data=json.dumps(dict(input=texts, model=self._deployment,
            dimensions=self._metadata.dimension, encoding_format='float')).encode(),
            headers={'Content-Type': 'application/json', 'api-key': self._api_key}, method='POST')
        try:
            with self._opener.open(request, timeout=8) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError('Response limit')
            payload = json.loads(raw)
            # Provider results may arrive out of order; reject duplicate/missing indexes.
            data = sorted(payload['data'], key=lambda item: item['index'])
            if [item['index'] for item in data] != list(range(len(texts))) or payload['model'] != self._metadata.name:
                raise ValueError('Model or embedding count differs from deployment contract')
            return EmbeddingBatch(metadata=self._metadata, vectors=[item['embedding'] for item in data])
        except HTTPError as failure:
            raise EmbeddingError(failure.code in (408, 429, 500, 502, 503, 504)) from None
        except (OSError, URLError):
            raise EmbeddingError(True) from None
        except (ValueError, KeyError, TypeError):
            raise EmbeddingError() from None

    def embed_query(self, text):
        return self.embed_documents([text])


class OpenAiCompatibleEmbeddingProvider:
    """Fixed dimensional vector space; persisted namespace includes provider/model/version."""
    def __init__(self, base_url, api_key, metadata, opener=None):
        from ..ai.compatible_http import api_base_url, bearer_key
        self._url = api_base_url(base_url) + '/embeddings'
        self._api_key = bearer_key(api_key)
        if metadata.provider != 'openai-compatible':
            raise ValueError('Compatible embedding metadata is required')
        self._metadata = metadata
        self._opener = opener or build_opener(_NoRedirect)

    def model_metadata(self):
        return self._metadata

    def embed_documents(self, texts):
        from ..ai.compatible_http import RESPONSE_LIMIT, transient_status
        request = Request(self._url, data=json.dumps(dict(input=texts, model=self._metadata.name,
            dimensions=self._metadata.dimension, encoding_format='float')).encode(), method='POST',
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self._api_key})
        try:
            with self._opener.open(request, timeout=8) as response:
                raw = response.read(RESPONSE_LIMIT + 1)
            if len(raw) > RESPONSE_LIMIT:
                raise ValueError('Response limit')
            payload = json.loads(raw)
            data = sorted(payload['data'], key=lambda item: item['index'])
            if payload['model'] != self._metadata.name or [item['index'] for item in data] != list(range(len(texts))):
                raise ValueError('Embedding model/count mismatch')
            return EmbeddingBatch(metadata=self._metadata, vectors=[item['embedding'] for item in data])
        except HTTPError as failure:
            transient = transient_status(failure.code)
            failure.close()
            raise EmbeddingError(transient) from None
        except (OSError, URLError):
            raise EmbeddingError(True) from None
        except (ValueError, KeyError, TypeError, IndexError):
            raise EmbeddingError() from None

    def embed_query(self, text):
        return self.embed_documents([text])


@dataclass(frozen=True)
class RetryPolicy:
    attempts: int = 3
    initial_delay: float = 0.2
    max_delay: float = 1.0

    def __post_init__(self):
        if not 1 <= self.attempts <= 5 or not 0 < self.initial_delay <= self.max_delay <= 5:
            raise ValueError('Invalid embedding retry policy')


class BatchedEmbeddingProvider:
    """Reusable batching, response validation and bounded transient-only retry."""
    def __init__(self, provider: EmbeddingProvider, batch_size=32, policy=RetryPolicy(), sleep=time.sleep):
        if not 1 <= batch_size <= 32:
            raise ValueError('Embedding batch size must be between 1 and 32')
        self._provider, self._batch_size, self._policy, self._sleep = provider, batch_size, policy, sleep

    def model_metadata(self):
        return self._provider.model_metadata()

    def _call(self, texts, query=False):
        for attempt in range(self._policy.attempts):
            try:
                result = self._provider.embed_query(texts[0]) if query else self._provider.embed_documents(texts)
                if result.metadata != self.model_metadata() or len(result.vectors) != len(texts):
                    raise EmbeddingError()
                return EmbeddingBatch.model_validate(result.model_dump())
            except EmbeddingError as error:
                if not error.transient or attempt + 1 == self._policy.attempts:
                    raise
                self._sleep(min(self._policy.initial_delay * 2 ** attempt, self._policy.max_delay))

    @staticmethod
    def _validate(texts):
        if len(texts) > 10000 or any(not isinstance(t, str) or not t.strip() or len(t) > 8000 for t in texts):
            raise ValueError('Invalid embedding text')

    def embed_documents(self, texts):
        self._validate(texts)
        vectors = []
        for start in range(0, len(texts), self._batch_size):
            vectors.extend(self._call(texts[start:start + self._batch_size]).vectors)
        return EmbeddingBatch(metadata=self.model_metadata(), vectors=vectors)

    def embed_query(self, text):
        self._validate([text])
        return self._call([text], query=True)


def configured_provider():
    name = os.getenv('AI_WORKER_EMBEDDING_PROVIDER', 'deterministic')
    if name == 'deterministic':
        provider = FakeEmbeddingProvider()
    elif name == 'azure':
        provider = AzureEmbeddingProvider(os.environ['AZURE_EMBEDDING_ENDPOINT'], os.environ['AZURE_EMBEDDING_API_KEY'],
            os.environ['AZURE_EMBEDDING_DEPLOYMENT'], ModelMetadata(provider='azure', name=os.environ['AZURE_EMBEDDING_MODEL'],
                version=os.environ['AZURE_EMBEDDING_VERSION'], dimension=int(os.environ['AZURE_EMBEDDING_DIMENSION'])))
    elif name == 'openai-compatible':
        provider = OpenAiCompatibleEmbeddingProvider(os.environ['OPENAI_COMPAT_BASE_URL'], os.environ['OPENAI_COMPAT_API_KEY'],
            ModelMetadata(provider=name, name=os.environ['OPENAI_COMPAT_EMBEDDING_MODEL'],
                version=os.environ['OPENAI_COMPAT_EMBEDDING_VERSION'], dimension=int(os.environ['OPENAI_COMPAT_EMBEDDING_DIMENSION'])))
    else:
        raise ValueError('Unknown embedding provider')
    return BatchedEmbeddingProvider(provider)

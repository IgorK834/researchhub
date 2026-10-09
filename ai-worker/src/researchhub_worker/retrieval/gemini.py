"""Native task-aware Gemini embeddings with a fixed, persisted vector space."""
import json
import math
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, Request, build_opener

from ..ai import gemini_http as http
from .embeddings import EmbeddingBatch, EmbeddingError, ModelMetadata, _NoRedirect


class GeminiEmbeddingProvider:
    def __init__(self, api_key, model=http.DEFAULT_EMBEDDING_MODEL, version=http.DEFAULT_EMBEDDING_VERSION,
                 dimension=768, base_url=http.DEFAULT_BASE_URL, opener=None, request_timeout=30, operation_timeout=90):
        self._url = http.base_url(base_url) + '/models/' + http.model_name(model) + ':batchEmbedContents'
        self._api_key = http.bearer_key(api_key)
        if not 128 <= dimension <= 3072:
            raise ValueError('Gemini text embedding dimension must be between 128 and 3072')
        self._metadata = ModelMetadata(provider='gemini', name=model, version=version, dimension=dimension)
        self._timeout = http.seconds(request_timeout, 1, 60)
        self._budget = http.seconds(operation_timeout, self._timeout, 90)
        self._opener = opener or build_opener(_NoRedirect, HTTPSHandler(context=http.tls_context()))

    def model_metadata(self):
        return self._metadata

    def operation_scope(self):
        return http.operation_scope(self._budget)

    def _embed(self, texts, task):
        if not texts or len(texts) > http.embedding_batch_size(self._metadata.dimension):
            raise ValueError('Use the bounded embedding batch wrapper')
        # gemini-embedding-001 currently honors the native per-request fields.
        # Its live batch endpoint ignores embedContentConfig.outputDimensionality
        # and returns 3072 dimensions instead. Always validate the actual result.
        body = {'requests': [{'model': 'models/' + self._metadata.name,
            'content': {'parts': [{'text': text}]},
            'taskType': task, 'outputDimensionality': self._metadata.dimension}
            for text in texts]}
        outbound = Request(self._url, data=json.dumps(body).encode(), method='POST', headers={
            'Content-Type': 'application/json', 'x-goog-api-key': self._api_key})
        try:
            with self._opener.open(outbound, timeout=http.remaining_timeout(self._timeout)) as response:
                raw = http.read_bounded(response, self._timeout)
            if len(raw) > http.RESPONSE_LIMIT:
                raise ValueError('Embedding response limit')
            items = json.loads(raw)['embeddings']
            if len(items) != len(texts):
                raise ValueError('Embedding count mismatch')
            result = EmbeddingBatch(metadata=self._metadata, vectors=[item['values'] for item in items])
            vectors = []
            for vector in result.vectors:
                norm = math.hypot(*vector)
                if not math.isfinite(norm) or norm == 0:
                    raise ValueError('Invalid embedding norm')
                vectors.append([value / norm for value in vector])
            return EmbeddingBatch(metadata=self._metadata, vectors=vectors)
        except HTTPError as failure:
            transient = http.transient_status(failure.code)
            failure.close()
            raise EmbeddingError(transient) from None
        except (OSError, URLError):
            raise EmbeddingError(True) from None
        except (ValueError, KeyError, TypeError, IndexError):
            raise EmbeddingError() from None

    def embed_documents(self, texts):
        return self._embed(texts, 'RETRIEVAL_DOCUMENT')

    def embed_query(self, text):
        return self._embed([text], 'RETRIEVAL_QUERY')


def configured_embeddings():
    return GeminiEmbeddingProvider(http.setting('GEMINI_API_KEY', ''),
        model=http.setting('GEMINI_EMBEDDING_MODEL', http.DEFAULT_EMBEDDING_MODEL),
        version=http.setting('GEMINI_EMBEDDING_VERSION', http.DEFAULT_EMBEDDING_VERSION),
        dimension=int(http.setting('GEMINI_EMBEDDING_DIMENSION', '768')),
        base_url=http.setting('GEMINI_BASE_URL', http.DEFAULT_BASE_URL),
        request_timeout=http.setting('GEMINI_REQUEST_TIMEOUT_SECONDS', '30'),
        operation_timeout=http.setting('GEMINI_OPERATION_TIMEOUT_SECONDS', '90'))

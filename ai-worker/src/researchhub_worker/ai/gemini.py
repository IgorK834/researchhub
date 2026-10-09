"""Native generateContent adapter; the public ResearchHub contracts stay vendor neutral."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, Request, build_opener

from . import gemini_http as http
from .compatible_schema import validate_output
from .context import ContextualRequest
from .contracts import ModelMetadata, UsageMetadata
from .providers import ProviderError, StructuredChatProvider, _NoRedirect
from .safety import model_messages
from .telemetry import record_payload


class GeminiModelProvider(StructuredChatProvider):
    def __init__(self, api_key, model=http.DEFAULT_MODEL, version=http.DEFAULT_VERSION,
                 base_url=http.DEFAULT_BASE_URL, opener=None, request_timeout=30,
                 operation_timeout=90, thinking_level='low', planning_thinking_level='medium'):
        self._url = http.base_url(base_url) + '/models/' + http.model_name(model) + ':generateContent'
        self._api_key = http.bearer_key(api_key)
        self._metadata = ModelMetadata(provider='gemini', name=model, version=version)
        self._opener = opener or build_opener(_NoRedirect, HTTPSHandler(context=http.tls_context()))
        self._timeout = http.seconds(request_timeout, 1, 60)
        self._budget = http.seconds(operation_timeout, self._timeout, 90)
        self._thinking, self._planning_thinking = thinking_level.upper(), planning_thinking_level.upper()
        if self._thinking not in {'LOW', 'MEDIUM', 'HIGH'} or self._planning_thinking not in {'LOW', 'MEDIUM', 'HIGH'}:
            raise ValueError('Gemini thinking level must be low, medium or high')

    def operation_scope(self):
        return http.operation_scope(self._budget)

    def _schema_rejected(self, failure):
        if failure.code not in (400, 422):
            return False
        try:
            raw = http.read_bounded(failure, self._timeout)
            if len(raw) > http.RESPONSE_LIMIT:
                return False
            error = json.loads(raw)['error']
            message = error['message'].casefold()
            # Google also uses this generic INVALID_ARGUMENT envelope when a
            # complex JSON schema is rejected. One JSON-mode fallback is safe;
            # the original complete application schema still validates locally.
            if failure.code == 400 and error.get('status') == 'INVALID_ARGUMENT' and message == 'request contains an invalid argument.':
                return True
            return ('schema' in message or 'responseformat' in message) and any(
                word in message for word in ('unsupported', 'not supported', 'does not support'))
        except (ValueError, KeyError, TypeError, AttributeError, OSError):
            return False

    def _daily_quota_exhausted(self, failure):
        if failure.code != 429:
            return False
        try:
            raw = http.read_bounded(failure, self._timeout)
            if len(raw) > http.RESPONSE_LIMIT:
                return False
            details = json.loads(raw)['error'].get('details', [])
            return any('PerDay' in violation.get('quotaId', '')
                for detail in details for violation in detail.get('violations', []))
        except (ValueError, KeyError, TypeError, AttributeError, OSError):
            return False

    def _decode(self, payload):
        # Record billed thinking tokens even on refusals or locally invalid output.
        blocked = payload.get('promptFeedback', {}).get('blockReason') or any(
            c.get('finishReason') in {'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'}
            for c in payload.get('candidates', []))
        normalized = {'model': self._metadata.name}
        try:
            raw_usage = payload['usageMetadata']
            values = [raw_usage['promptTokenCount'], raw_usage.get('candidatesTokenCount', 0),
                raw_usage.get('thoughtsTokenCount', 0), raw_usage['totalTokenCount']]
            if any(type(value) is not int or value < 0 for value in values):
                raise ValueError('Invalid native token counts')
            usage = UsageMetadata(input_tokens=values[0], output_tokens=values[1] + values[2], total_tokens=values[3], estimated=False)
            normalized['usage'] = {'prompt_tokens': usage.input_tokens, 'completion_tokens': usage.output_tokens, 'total_tokens': usage.total_tokens}
            record_payload(self._metadata, normalized, accumulate=True)
        except (ValueError, KeyError, TypeError):
            if not blocked:
                raise
        if blocked:
            raise ProviderError('AI_REFUSED')
        revision = payload['modelVersion']
        if not isinstance(revision, str) or len(revision) > 128 or not (
                revision == self._metadata.name or revision.startswith(self._metadata.name + '-')):
            raise ValueError('Unexpected Gemini model revision')
        identifier = payload['responseId']
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 128:
            raise ValueError('Invalid Gemini response identity')
        if raw_usage.get('toolUsePromptTokenCount', 0) != 0 or len(payload['candidates']) != 1:
            raise ValueError('Unexpected Gemini capabilities or candidate count')
        candidate = payload['candidates'][0]
        finish = candidate['finishReason']
        if finish != 'STOP':
            raise ProviderError('AI_OUTPUT_INVALID')
        content = candidate['content']
        if content.get('role') != 'model' or not content['parts']:
            raise ValueError('Invalid Gemini content')
        parts = content['parts']
        if any(not isinstance(p.get('text'), str) or p.get('thought') or
               set(p) - {'text', 'thought', 'thoughtSignature'} for p in parts):
            raise ValueError('Unexpected non-text or private reasoning output')
        text = ''.join(p['text'] for p in parts)
        if len(text.encode()) > 64000:
            raise ProviderError('AI_OUTPUT_INVALID')
        normalized.update(id=identifier, choices=[{'finish_reason': 'stop', 'message': {'content': text}}])
        return normalized

    def complete(self, input_request, schema, schema_name):
        with self.operation_scope():
            return self._complete(input_request, schema, schema_name)

    def _complete(self, input_request, schema, schema_name):
        from ..analysis.contracts import PlanningRequest
        contextual = isinstance(input_request, (ContextualRequest, PlanningRequest))
        request = input_request.request if contextual else input_request
        messages = model_messages(request.system_instruction, input_request.user_message() if contextual else
            json.dumps({'instruction': request.instruction,
                'evidence': [item.model_dump(by_alias=True) for item in request.evidence]}, ensure_ascii=False))
        system = messages[0]['content'] + '\nApplication contract: ' + schema_name
        if isinstance(input_request, ContextualRequest) and schema_name in {
                'researchhub_authoring_v1', 'researchhub_source_analysis_v1'}:
            keys = [binding.citation_key for binding in input_request.context.summary.citations]
            system += ('\nCitation fields citationKey, citationKeys and evidenceIds must use only these local labels: '
                + json.dumps(keys) + '. Never put chunk hashes or source UUIDs in citation fields. '
                'Source identity fields such as sourceId still use the supplied source UUIDs.')
        if schema_name in {'researchhub_answer_v1', 'researchhub_answer_v2'}:
            system += ('\nAnswer only the requested facts; omit unrelated background claims. '
                'If a requested value was not measured or is absent, return INSUFFICIENT_EVIDENCE with no claims. '
                'A citation saying a measurement is missing does not supply its value. '
                'Prefer short quotations of directly relevant supplied evidence when feasible.')
        body = {'store': False, 'systemInstruction': {'parts': [{'text': system}]},
            'contents': [{'role': 'user', 'parts': [{'text': messages[1]['content']}]}],
            'generationConfig': {'candidateCount': 1, 'maxOutputTokens': request.parameters.max_output_tokens,
                'thinkingConfig': {'includeThoughts': False, 'thinkingLevel':
                    self._planning_thinking if isinstance(input_request, PlanningRequest) else self._thinking},
                'responseFormat': {'text': {'mimeType': 'APPLICATION_JSON', 'schema': schema}}}}
        if request.parameters.temperature is not None:
            body['generationConfig']['temperature'] = request.parameters.temperature
        fallback, repaired, attempts, counts = False, False, 0, [0, 0, 0]
        while True:
            attempts += 1
            try:
                outbound = Request(self._url, data=json.dumps(body).encode(), method='POST', headers={
                    'Content-Type': 'application/json', 'x-goog-api-key': self._api_key})
                try:
                    with self._opener.open(outbound, timeout=http.remaining_timeout(self._timeout)) as response:
                        raw = http.read_bounded(response, self._timeout)
                except HTTPError as failure:
                    try:
                        if not fallback and not repaired and self._schema_rejected(failure):
                            fallback = True
                            del body['generationConfig']['responseFormat']['text']['schema']
                            body['systemInstruction']['parts'][0]['text'] += '\nReturn JSON satisfying: ' + json.dumps(schema)
                            continue
                        transient = http.transient_status(failure.code)
                        retryable = transient and attempts == 1 and not self._daily_quota_exhausted(failure)
                        raise ProviderError('AI_UNAVAILABLE' if transient else 'AI_PROVIDER_ERROR', retryable) from None
                    finally:
                        failure.close()
                if len(raw) > http.RESPONSE_LIMIT:
                    raise ProviderError('AI_OUTPUT_INVALID')
                payload = self._decode(json.loads(raw))
                counts = [a + b for a, b in zip(counts, payload['usage'].values())]
                try:
                    validate_output(payload['choices'][0]['message']['content'], schema_name, input_request)
                except (ValueError, KeyError, TypeError):
                    if repaired:
                        raise ProviderError('AI_OUTPUT_INVALID') from None
                    repaired = True
                    body['systemInstruction']['parts'][0]['text'] += (
                        '\nThe prior response failed application validation. Regenerate once from the original inputs; '
                        'use only supplied citation keys and satisfy the application schema. Return JSON only.')
                    continue
                payload['usage'] = dict(zip(('prompt_tokens', 'completion_tokens', 'total_tokens'), counts))
                return payload
            except ProviderError:
                raise
            except (OSError, URLError):
                raise ProviderError('AI_UNAVAILABLE', attempts == 1) from None
            except (ValueError, KeyError, TypeError, IndexError, AttributeError):
                raise ProviderError('AI_OUTPUT_INVALID') from None


def configured_model():
    return GeminiModelProvider(http.setting('GEMINI_API_KEY', ''),
        model=http.setting('GEMINI_MODEL', http.DEFAULT_MODEL),
        version=http.setting('GEMINI_MODEL_VERSION', http.DEFAULT_VERSION),
        base_url=http.setting('GEMINI_BASE_URL', http.DEFAULT_BASE_URL),
        request_timeout=http.setting('GEMINI_REQUEST_TIMEOUT_SECONDS', '30'),
        operation_timeout=http.setting('GEMINI_OPERATION_TIMEOUT_SECONDS', '90'),
        thinking_level=http.setting('GEMINI_THINKING_LEVEL', 'low'),
        planning_thinking_level=http.setting('GEMINI_PLANNING_THINKING_LEVEL', 'medium'))

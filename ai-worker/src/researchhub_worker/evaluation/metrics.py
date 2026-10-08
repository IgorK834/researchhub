"""Deterministic, explicitly bounded judgments for the curated evaluation suite."""
import math
import re
import unicodedata

from ..retrieval.contracts import digest, identity_digest


def normalize(text):
    return ' '.join(unicodedata.normalize('NFKC', text).casefold().split())


def matches(patterns, text, full=False):
    operation = re.fullmatch if full else re.search
    return any(operation(pattern, normalize(text), re.IGNORECASE) is not None for pattern in patterns)


def covered_by(chunks, location):
    intervals = sorted((s.character_start, s.character_end) for chunk in chunks
        if chunk.source_id == location.source_id and (location.page is None or
            chunk.page_start is not None and chunk.page_start <= location.page <= chunk.page_end)
        for s in chunk.spans if s.unit_id == location.unit_id)
    cursor = location.character_start
    for start, end in intervals:
        if start > cursor:
            break
        cursor = max(cursor, end)
    return cursor >= location.character_end


def fraction(found, expected):
    return len(found & expected) / len(expected) if expected else None


def retrieval_metrics(case, chunks, top_k, exact_chunks=True):
    ranked = chunks[:top_k]
    expected = set(case.expected_source_ids)
    locations = [loc for fact in case.expected_facts for loc in fact.locations]
    # Distinct physical source/page targets; unknown pages are excluded, not failures.
    pages = {(loc.source_id, loc.page) for loc in locations if loc.page is not None}
    hit_pages = {page for page in pages if any(c.source_id == page[0] and c.page_start is not None
        and c.page_start <= page[1] <= c.page_end for c in ranked)}
    chunk_ids = {id for loc in locations for id in loc.chunk_ids}
    rank = next((i for i, chunk in enumerate(ranked, 1) if any(covered_by([chunk], loc) for loc in locations)), None)
    source_hits = {chunk.source_id for chunk in ranked}
    return {
        'sourceRecallAtK': fraction(source_hits, expected),
        'chunkRecallAtK': fraction({c.chunk_id for c in ranked}, chunk_ids) if exact_chunks else None,
        'spanRecallAtK': sum(covered_by(ranked, loc) for loc in locations) / len(locations) if locations else None,
        'mrrAtK': (1 / rank if rank else 0.0) if locations else None,
        'sourceHitRate': float(bool(source_hits & expected)) if expected else None,
        'pageHitRate': fraction(hit_pages, pages),
        'returnedChunks': len(ranked),
    }


def answer_metrics(case, observation):
    answer, chunks = observation.answer, observation.provided_chunks
    provided = {chunk.chunk_id: chunk for chunk in chunks}
    citations = [id for claim in answer.claims for id in claim.evidence_ids]
    valid = [id for id in citations if id in provided]
    text = '\n'.join(claim.text for claim in answer.claims)
    forbidden = matches(case.forbidden_patterns, text)
    found = [fact.id for fact in case.expected_facts if matches(fact.answer_patterns, text)]
    fact_coverage = len(found) / len(case.expected_facts) if case.expected_facts else None
    decisions = []
    for claim in answer.claims:
        cited = [provided[id] for id in claim.evidence_ids if id in provided]
        # Evaluate each sentence; an extra invented sentence cannot hide behind a correct fact.
        statements = [s for s in re.split(r'(?<=[.!?])\s+|\n+', claim.text.strip()) if s.strip()]
        for statement in statements:
            exact_quote = any(normalize(statement) in normalize(chunk.content) for chunk in cited)
            curated = any(matches(fact.supported_statements, statement, full=True) and
                any(covered_by(cited, loc) for loc in fact.locations) for fact in case.expected_facts)
            supported = (len(cited) == len(claim.evidence_ids) and not matches(case.forbidden_patterns, statement)
                and (exact_quote or curated))
            decisions.append({'statement': statement, 'supportedByCuratedRules': supported,
                'rule': 'verbatim-cited-passage' if supported and exact_quote else
                        'curated-statement-and-span' if supported else 'no-curated-support'})
    cited_sources = {provided[id].source_id for id in valid}
    return {
        'citationValidity': len(valid) / len(citations) if citations else None,
        'expectedSourceCoverage': fraction(cited_sources, set(case.expected_source_ids)),
        'factCoverage': fact_coverage,
        'answerCorrectness': float(answer.status == case.expected_status and not forbidden
            and (fact_coverage == 1.0 if case.expected_facts else not answer.claims)),
        'unsupportedClaimRate': sum(not d['supportedByCuratedRules'] for d in decisions) / len(decisions) if decisions else None,
        'unsupportedStatements': sum(not d['supportedByCuratedRules'] for d in decisions),
        'assessedStatements': len(decisions),
        'invalidCitations': len(citations) - len(valid),
        'statusCorrect': float(answer.status == case.expected_status),
        'forbiddenAnswer': forbidden,
        'matchedFacts': found,
        'claimChecks': decisions,
    }


def observation_hash(case, observation):
    return identity_digest([case.model_dump(mode='json', by_alias=True),
        observation.model_dump(mode='json', by_alias=True, exclude={'latency_ms'})])


def cost(usage, pricing):
    if usage is None or pricing is None:
        return None
    return (usage.input_tokens * pricing.input_per_million + usage.output_tokens * pricing.output_per_million) / 1_000_000


def percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q * len(values)) - 1)]


QUALITY_METRICS = ('sourceRecallAtK', 'chunkRecallAtK', 'spanRecallAtK', 'mrrAtK', 'sourceHitRate',
    'pageHitRate', 'citationValidity', 'expectedSourceCoverage', 'factCoverage', 'answerCorrectness',
    'unsupportedClaimRate', 'statusCorrect')


def aggregate(rows):
    result = {'observations': len(rows), 'failures': sum(row['error'] is not None for row in rows)}
    for name in QUALITY_METRICS:
        values = [row['metrics'][name] for row in rows if row['metrics'].get(name) is not None]
        result[name] = {'value': sum(values) / len(values) if values else None, 'eligible': len(values)}
    for name in ('retrievalLatencyMs', 'answerLatencyMs'):
        values = [row['metrics'][name] for row in rows if row['metrics'].get(name) is not None]
        result[name] = {'mean': sum(values) / len(values) if values else None,
            'p50': percentile(values, 0.5), 'p95': percentile(values, 0.95), 'measured': len(values)}
    for name in ('inputTokens', 'outputTokens', 'totalTokens', 'estimatedCost'):
        values = [row['metrics'][name] for row in rows if row['metrics'].get(name) is not None]
        result[name] = {'total': sum(values) if values else None, 'measured': len(values)}
    return result

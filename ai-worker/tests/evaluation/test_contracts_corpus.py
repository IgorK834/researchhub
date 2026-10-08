from copy import deepcopy
import json
from pathlib import Path
import shutil

import pytest

from researchhub_worker.evaluation.contracts import Suite, RunConfig, JudgeSignal, Location, Fact
from researchhub_worker.evaluation.corpus import load_suite, parse_source, source_path
from researchhub_worker.retrieval.contracts import ChunkingConfig


def copy_suite(tmp_path, loaded):
    target = tmp_path / 'corpus'
    shutil.copytree(loaded.root, target)
    return target / 'suite.json'


def test_suite_is_representative_and_all_gold_locations_are_real(loaded):
    assert len(loaded.suite.cases) >= 20
    assert len({s.workspace_fixture_id for s in loaded.suite.sources}) == 2
    tags = {t for c in loaded.suite.cases for t in c.tags}
    assert {'comparison', 'unicode', 'negation', 'workspace-isolation', 'schema-only', 'insufficient'} <= tags
    assert {'PDF', 'DOCX', 'TXT', 'CSV'} <= {s.source_type for s in loaded.suite.sources}
    assert loaded == load_suite(loaded.root / 'suite.json')
    assert loaded.chunks(ChunkingConfig()) == loaded.chunks(ChunkingConfig())


@pytest.mark.parametrize('change', [
    lambda p: p.update(cases=p['cases'][:19]),
    lambda p: p['cases'].append(deepcopy(p['cases'][0])),
    lambda p: p['sources'].append(deepcopy(p['sources'][0])),
    lambda p: p['cases'][0].update(question='   '),
    lambda p: p['cases'][0].update(expectedSourceIds=[]),
    lambda p: p['cases'][0].update(expectedStatus='INSUFFICIENT_EVIDENCE'),
    lambda p: p['cases'][0].update(selectedSourceIds=[]),
    lambda p: p['cases'][0].update(workspaceFixtureId=p['sources'][-1]['workspaceFixtureId']),
    lambda p: p['cases'][0].update(expectedSourceIds=[p['sources'][-1]['id']]),
    lambda p: p['cases'][0].update(selectedSourceIds=[p['sources'][-1]['id']]),
    lambda p: p['cases'][0].update(forbiddenPatterns=['[']),
    lambda p: p['cases'][0].update(forbiddenPatterns=['']),
    lambda p: p['cases'][0]['expectedFacts'][0].update(answerPatterns=['[']),
    lambda p: p['cases'][0]['expectedFacts'][0].update(supportedStatements=['']),
    lambda p: p['cases'][0]['expectedFacts'][0]['locations'][0].update(characterEnd=0),
    lambda p: p.update(unexpected=True),
])
def test_strict_fixture_schema_rejects_incoherent_cases(loaded, change):
    payload = loaded.suite.model_dump(mode='json', by_alias=True)
    change(payload)
    with pytest.raises(ValueError):
        Suite.model_validate(payload)


@pytest.mark.parametrize('mutation', [
    lambda p: p['sources'][0].update(path='../outside.pdf'),
    lambda p: p['sources'][0].update(sha256='0'*64),
    lambda p: p['sources'][0].update(extractionSha256='0'*64),
    lambda p: p['cases'][0]['expectedFacts'][0]['locations'][0].update(unitId='missing'),
    lambda p: p['cases'][0]['expectedFacts'][0]['locations'][0].update(page=999),
    lambda p: p['cases'][0]['expectedFacts'][0]['locations'][0].update(characterEnd=10000),
    lambda p: p['cases'][0]['expectedFacts'][0]['locations'][0].update(chunkIds=['0'*64]),
])
def test_corpus_drift_missing_files_and_fabricated_gold_are_rejected(tmp_path, loaded, mutation):
    path = copy_suite(tmp_path, loaded)
    payload = json.loads(path.read_text())
    mutation(payload)
    path.write_text(json.dumps(payload))
    with pytest.raises(ValueError):
        load_suite(path)


def test_parser_failure_and_path_symlink_cannot_escape_corpus(loaded, tmp_path):
    source = loaded.suite.sources[0]
    with pytest.raises(ValueError):
        parse_source(source, b'invalid PDF', ChunkingConfig())
    outside = tmp_path / 'outside.pdf'
    outside.write_bytes(b'outside')
    root = tmp_path / 'root'
    root.mkdir()
    (root / source.path).symlink_to(outside)
    with pytest.raises(ValueError):
        source_path(root, source)


def test_explicit_configuration_ignores_chunking_and_parser_environment(loaded, monkeypatch):
    monkeypatch.setenv('AI_WORKER_CHUNK_MAX_CHARACTERS', 'invalid')
    monkeypatch.setenv('AI_WORKER_MAX_CHARACTERS', 'invalid')
    assert loaded.suite_hash == load_suite(loaded.root / 'suite.json').suite_hash


@pytest.mark.parametrize('changes', [{'topK': 0}, {'topK': True}, {'repetitions': 21}, {'systemInstruction': ' '},
    {'index': 'external-search'}, {'pricing': {'currency': 'USD', 'inputPerMillion': -1, 'outputPerMillion': 1, 'revision': '1'}}])
def test_run_settings_are_bounded(config, changes):
    with pytest.raises(ValueError):
        RunConfig.model_validate(config.model_dump(by_alias=True) | changes)


def test_locations_must_have_nonempty_ranges_and_unique_chunks():
    base = {'sourceId': '10000000-0000-0000-0000-000000000003', 'unitId': 'u', 'characterStart': 2, 'characterEnd': 1}
    with pytest.raises(ValueError):
        Location(**base)
    with pytest.raises(ValueError):
        Location(**(base | {'characterEnd': 3, 'chunkIds': ['a'*64, 'a'*64]}))

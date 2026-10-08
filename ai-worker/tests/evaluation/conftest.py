from pathlib import Path
import pytest

from researchhub_worker.evaluation.contracts import RunConfig
from researchhub_worker.evaluation.corpus import load_suite

FIXTURES = Path(__file__).resolve().parents[2] / 'src/researchhub_worker/evaluation/fixtures'


@pytest.fixture(scope='session')
def loaded():
    return load_suite(FIXTURES / 'suite.json')


@pytest.fixture
def config():
    return RunConfig.model_validate_json((FIXTURES / 'baseline.json').read_text())

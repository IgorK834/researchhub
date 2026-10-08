"""researchhub-evaluate: run/seed/compare without adding product infrastructure."""
import argparse
import json
import os
from pathlib import Path

from ..ai.providers import configured_gateway
from .contracts import JudgeSignal, RunConfig
from .corpus import load_suite
from .live import SpringBackend, SpringClient, seed
from .offline import OfflineBackend
from .report import compare, comparison_markdown, markdown, write_json
from .runner import run

FIXTURES = Path(__file__).resolve().parent / 'fixtures'


def client(args):
    connection = SpringClient(args.url, args.ca_file)
    connection.login(os.environ.get('RH_EVALUATION_EMAIL'), os.environ.get('RH_EVALUATION_PASSWORD'))
    return connection


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    execute = commands.add_parser('run', help='Evaluate the fixed suite and write JSON + Markdown')
    execute.add_argument('--suite', type=Path, default=FIXTURES / 'suite.json')
    execute.add_argument('--config', type=Path, default=FIXTURES / 'baseline.json')
    execute.add_argument('--output', type=Path, required=True)
    execute.add_argument('--mode', choices=('offline', 'spring'), default='offline')
    execute.add_argument('--configured-model', action='store_true', help='Explicitly use worker provider env (may incur paid calls)')
    execute.add_argument('--judge-signals', type=Path, help='Explicit imperfect supplemental, hash-bound model judgments')
    execute.add_argument('--bindings', type=Path)
    execute.add_argument('--url')
    execute.add_argument('--ca-file')
    prepare = commands.add_parser('seed', help='Idempotently upload the fixed corpus through authorized Spring APIs')
    prepare.add_argument('--suite', type=Path, default=FIXTURES / 'suite.json')
    prepare.add_argument('--url', required=True)
    prepare.add_argument('--ca-file')
    prepare.add_argument('--output', type=Path, required=True)
    paired = commands.add_parser('compare', help='Compare compatible reports; exit 1 for quality regression')
    paired.add_argument('baseline', type=Path)
    paired.add_argument('candidate', type=Path)
    paired.add_argument('--output', type=Path, required=True)
    paired.add_argument('--max-quality-drop', type=float, default=0)
    candidates = commands.add_parser('models', help='Evaluate a pinned candidate matrix and explicit demo thresholds')
    candidates.add_argument('--suite', type=Path, default=FIXTURES / 'suite.json')
    candidates.add_argument('--config', type=Path, default=FIXTURES / 'baseline.json')
    candidates.add_argument('--matrix', type=Path, required=True)
    candidates.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'compare':
            result = compare(json.loads(args.baseline.read_text()), json.loads(args.candidate.read_text()), args.max_quality_drop)
            write_json(args.output, result)
            args.output.with_suffix('.md').write_text(comparison_markdown(result), encoding='utf-8')
            print('Comparison PASS' if result['passed'] else 'Comparison FAIL: ' + ', '.join(result['regressions']))
            return 0 if result['passed'] else 1
        loaded = load_suite(args.suite)
        if args.command == 'models':
            from .models import Matrix, evaluate
            matrix = Matrix.model_validate_json(args.matrix.read_text())
            result = evaluate(loaded, RunConfig.model_validate_json(args.config.read_text()), matrix, args.output)
            return 0 if result['preferredAccepted'] else 1
        if args.command == 'seed':
            result = seed(loaded, client(args))
            write_json(args.output, result)
            print(f'Seed verified: {len(result["sources"])} sources, {len(result["workspaces"])} workspaces')
            return 0
        config = RunConfig.model_validate_json(args.config.read_text())
        if args.mode == 'spring':
            if not args.url or not args.bindings or args.configured_model:
                raise ValueError('Spring evaluation requires URL/bindings and uses the server model')
            backend = SpringBackend(loaded, config, client(args), json.loads(args.bindings.read_text()))
        else:
            backend = OfflineBackend(loaded, config, configured_gateway() if args.configured_model else None)
        signals = [JudgeSignal.model_validate(s) for s in json.loads(args.judge_signals.read_text())] if args.judge_signals else []
        result = run(loaded, config, backend, judge_signals=signals)
        write_json(args.output, result)
        args.output.with_suffix('.md').write_text(markdown(result), encoding='utf-8')
        print(f"Evaluated {result['summary']['observations']} observations; failures={result['summary']['failures']}")
        return 1 if result['summary']['failures'] else 0
    except (ValueError, RuntimeError, OSError, KeyError, TypeError):
        # Pydantic/provider errors can contain source data or credentials; do not echo them.
        print('Evaluation failed: invalid fixture/configuration, corpus drift or unavailable authorized API. No report accepted.')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

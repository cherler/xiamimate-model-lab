"""Development-only reader and explicit, single-use holdout access for the next case.

These are workflow guards, not an OS security boundary: the original public archive
also contains February. Do not read that archive to tune on the held-out targets.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd

CONFIG = 'services/configs/evaluation-v1.json'
WORKSPACE = 'artifacts/protocols/ta-feng-evaluation-v1'


def digest(path):
    sha = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block)
    return sha.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def verify_workspace(root):
    root = Path(root)
    lock = read_json(root / 'docs/evaluation/protocol-lock.json')
    if digest(root / WORKSPACE / 'manifest.json') != lock['manifest_sha256']:
        raise ValueError('Frozen manifest changed')
    manifest = read_json(root / WORKSPACE / 'manifest.json')
    for relative, expected in manifest['files'].items():
        if digest(root / relative) != expected:
            raise ValueError(f'Frozen file changed: {relative}')
    return manifest


def load_development(root, cutoff=None):
    root = Path(root)
    verify_workspace(root)
    config = read_json(root / CONFIG)
    test_start = pd.Timestamp(config['time']['test'][0])
    cutoff = pd.Timestamp(cutoff) if cutoff is not None else test_start
    if cutoff > test_start:
        raise ValueError('Development cannot read final-test dates')
    frame = pd.read_csv(root / WORKSPACE / 'development.csv.gz', dtype={'customer': str, 'item': str, 'category': str}, parse_dates=['date'])
    if (frame.date >= test_start).any():
        raise ValueError('Final-test rows found in development file')
    return frame.loc[frame.date < cutoff].copy()


def require_past_labels(label_end_exclusive, origin):
    if pd.Timestamp(label_end_exclusive) > pd.Timestamp(origin):
        raise ValueError('A training label reaches into the forecast window')


def open_final_test(root, release_path):
    """Called only by a future final evaluator after development decisions are fixed.

    Consumes the holdout before loading it. Failures after this point do not allow
    a second evaluation. Results and any failed attempts must remain in the ledger.
    """
    root = Path(root)
    manifest = verify_workspace(root)
    config = read_json(root / CONFIG)
    release_path = Path(release_path)
    release = read_json(release_path)
    if release.get('protocol_sha256') != digest(root / CONFIG):
        raise ValueError('Release is not bound to the frozen protocol')
    if release.get('manifest_sha256') != digest(root / WORKSPACE / 'manifest.json'):
        raise ValueError('Release is not bound to the frozen dataset splits')
    files = release.get('files', {})
    if 'uv.lock' not in files or not any(p.endswith('.py') for p in files):
        raise ValueError('Release must freeze dependencies and training/evaluation source')
    for relative, expected in files.items():
        if digest(root / relative) != expected:
            raise ValueError(f'Release file changed: {relative}')
    tasks = release.get('tasks', {})
    if set(tasks) != set(config['final_evaluation']['required_tasks']):
        raise ValueError('Freeze all three task decisions before opening the test')
    for task, decision in tasks.items():
        required = {'selected_model', 'selected_parameters', 'baseline', 'features', 'development_result_path'}
        if (not required <= decision.keys() or not decision['selected_model'] or not decision['baseline']
                or not isinstance(decision['selected_parameters'], dict)
                or not isinstance(decision['features'], list) or not decision['features']):
            raise ValueError(f'Incomplete development decision: {task}')
        if decision['development_result_path'] not in files:
            raise ValueError(f'Development evidence is not hashed: {task}')
    ledger = root / WORKSPACE / 'final-test-access.json'
    # Exclusive creation is the one-shot guard; never overwrite an earlier access.
    with ledger.open('x') as stream:
        json.dump({'status': 'opened_consumed', 'release_sha256': digest(release_path),
                   'release': release, 'test_sha256': manifest['files'][f'{WORKSPACE}/sealed-test.csv.gz'],
                   'note': 'No test metrics produced by this access function. Any failure still consumes this holdout.'}, stream, ensure_ascii=False, indent=2)
    frame = pd.read_csv(root / WORKSPACE / 'sealed-test.csv.gz', dtype={'customer': str, 'item': str, 'category': str}, parse_dates=['date'])
    start, end = map(pd.Timestamp, config['time']['test'])
    if not ((frame.date >= start) & (frame.date < end)).all():
        raise ValueError('Unexpected final-test boundary; holdout remains consumed')
    return frame

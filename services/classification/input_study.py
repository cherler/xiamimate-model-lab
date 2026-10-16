"""Fixed-budget E9 fits and saved-model verification; no access to original test."""
from __future__ import annotations
import argparse
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
import joblib
import lightgbm as lgb
import numpy as np
import sklearn
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler
from sklearn.metrics import average_precision_score
from .run import ROOT, read, write, digest, metrics, confusion, choose_threshold, capacity_order, logit, assert_close
from .input_audit import PROTOCOL, AUDIT, ALLOWED, audit, columns, load_development

POINTER = ROOT/'artifacts/classification-input-latest.json'
RUNS = ROOT/'artifacts/classification-input-runs'
EXPORT = ROOT/'apps/web/classification-input-results'
RECORD = ROOT/'docs/evaluation/classification-input-export-v1.json'
SOURCES = ['services/classification/input_study.py', 'services/classification/input_audit.py', 'services/classification/run.py']


def sources():
    return {f: digest((ROOT/f).read_bytes()) for f in SOURCES}


def policy(y, p, groups, ids, share):
    selected = np.zeros(len(y), dtype=bool)
    selected[capacity_order(p, groups, ids)[:int(len(y)*share)]] = True
    return selected, confusion(y, selected)


def paired_counts(y, a, b):
    return {'corrected_fn': int(np.sum((y == 1) & a & ~b)),
            'new_fn': int(np.sum((y == 1) & ~a & b)),
            'corrected_fp': int(np.sum((y == 0) & ~a & b)),
            'new_fp': int(np.sum((y == 0) & a & ~b))}


def bootstrap(y, a, b, groups, cfg):
    indices = [np.flatnonzero(groups == g) for g in sorted(set(groups))]
    rng = np.random.default_rng(cfg['seed'])
    values = []
    for _ in range(cfg['repeats']):
        ix = np.concatenate([indices[i] for i in rng.integers(0, len(indices), len(indices))])
        if len(set(y[ix])) < 2:
            continue
        values.append([average_precision_score(y[ix], a[ix])-average_precision_score(y[ix], b[ix]),
                       np.mean((b[ix]-y[ix])**2-(a[ix]-y[ix])**2)])
    if not values:
        raise ValueError('No valid paired bootstrap samples')
    bounds = np.quantile(values, [.025, .975], axis=0)
    return {'ap_gain': bounds[:, 0].tolist(), 'brier_reduction': bounds[:, 1].tolist(), 'valid_resamples': len(values)}


def summaries(rows, thresholds, cfg):
    y = np.array([r['label'] for r in rows]); ids = np.array([r['source_row'] for r in rows])
    groups = np.array([r['group'] for r in rows])
    scores = {key: np.array([r['scores'][key] for r in rows]) for key in thresholds}
    results = {}
    for key, p in scores.items():
        results[key] = {'raw': metrics(y, np.array([r['raw_scores'][key] for r in rows])),
            'calibrated': metrics(y, p), 'threshold': thresholds[key], 'policy': confusion(y, p >= thresholds[key]),
            'capacity': {str(s): policy(y, p, groups, ids, s)[1] for s in cfg['capacity_shares']}}
    contrasts = [(f'all:{m}', f'{v}:{m}') for m in cfg['models'] for v in cfg['variants'] if v != 'all']
    contrasts += [(f'{v}:lightgbm', f'{v}:logistic') for v in cfg['variants']]
    pairs = []
    for a, b in contrasts:
        pairs.append({'a': a, 'b': b,
            'ap_gain': results[a]['calibrated']['ap']-results[b]['calibrated']['ap'],
            'brier_reduction': results[b]['calibrated']['brier']-results[a]['calibrated']['brier'],
            'intervals': bootstrap(y, scores[a], scores[b], groups, cfg['uncertainty']),
            'capacity': {str(s): paired_counts(y, policy(y, scores[a], groups, ids, s)[0],
                policy(y, scores[b], groups, ids, s)[0]) for s in cfg['capacity_shares']}})
    return {'models': results, 'pairs': pairs}


def run():
    if POINTER.exists():
        raise ValueError('E9 already run; verify saved models, do not silently repeat selection')
    cfg = read(PROTOCOL); audited = audit()
    if audited != read(AUDIT):
        raise ValueError('Audit does not match frozen protocol and inputs')
    parent = ROOT/'artifacts/classification-runs'/cfg['parent_run']
    meta = read(parent/'metadata.json'); original = meta['protocol']
    train = load_development('train', parent, meta); cal = load_development('calibration', parent, meta)
    run_id = 'classification-input-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    directory = RUNS/run_id; directory.mkdir(parents=True, exist_ok=False)
    write(POINTER, {'run_id': run_id, 'stage': 'training'})
    write(directory/'protocol.json', cfg)
    bundles = {}; timings = {}; thresholds = {}
    for variant in cfg['variants']:
        idx = columns(meta['features'], cfg, variant)
        for name in cfg['models']:
            tick = time.perf_counter(); key = f'{variant}:{name}'
            classifier = (LogisticRegression(**original['models'][name], random_state=cfg['seed']) if name == 'logistic'
                else lgb.LGBMClassifier(**original['models'][name], random_state=cfg['seed']))
            steps = [SimpleImputer(strategy='median')]
            if name == 'logistic':
                steps += [FunctionTransformer(np.log1p), StandardScaler()]
            model = make_pipeline(*steps, classifier).fit(train['x'][:, idx], train['y'])
            raw = model.predict_proba(cal['x'][:, idx])[:, 1]
            calibrator = LogisticRegression(C=1e6, solver='lbfgs', max_iter=1000).fit(logit(raw), cal['y'])
            p = calibrator.predict_proba(logit(raw))[:, 1]
            thresholds[key] = choose_threshold(cal['y'], p)
            bundles[key] = {'columns': idx, 'model': model, 'calibrator': calibrator}
            timings[key] = time.perf_counter()-tick
    joblib.dump(bundles, directory/'models.joblib')
    frozen = {'run_id': run_id, 'protocol_sha256': digest(PROTOCOL.read_bytes()), 'audit_sha256': digest(AUDIT.read_bytes()),
        'code_sha256': sources(), 'thresholds': thresholds, 'training_seconds': timings,
        'model_sha256': digest((directory/'models.joblib').read_bytes()),
        'environment': {'python': platform.python_version(), 'numpy': np.__version__, 'sklearn': sklearn.__version__, 'lightgbm': lgb.__version__},
        'access': {'partitions': list(ALLOWED), 'test_opened': False, 'scope': cfg['scope']}}
    write(directory/'frozen.json', frozen)
    # Fits and thresholds saved before validation prediction; validation is already-known development data.
    valid = load_development('validation', parent, meta)
    rows = predict_rows(bundles, valid)
    write(directory/'validation-rows.json', rows)
    result = summaries(rows, thresholds, cfg)
    write(directory/'result.json', result)
    write(POINTER, {'run_id': run_id, 'stage': 'complete'})
    verify()


def predict_rows(bundles, part):
    raw = {key: b['model'].predict_proba(part['x'][:, b['columns']])[:, 1] for key, b in bundles.items()}
    calibrated = {key: b['calibrator'].predict_proba(logit(raw[key]))[:, 1] for key, b in bundles.items()}
    return [{'id': f'mail-{int(i)+1:05d}', 'source_row': int(i)+1, 'group': str(g), 'label': int(y),
        'raw_scores': {k: float(v[j]) for k, v in raw.items()}, 'scores': {k: float(v[j]) for k, v in calibrated.items()}}
        for j, (i, g, y) in enumerate(zip(part['ids'], part['groups'], part['y']))]


def verify():
    pointer = read(POINTER)
    if pointer['stage'] != 'complete':
        raise ValueError('Training did not complete')
    directory = RUNS/pointer['run_id']; frozen = read(directory/'frozen.json'); cfg = read(PROTOCOL)
    if frozen['code_sha256'] != sources() or frozen['protocol_sha256'] != digest(PROTOCOL.read_bytes()) or frozen['audit_sha256'] != digest(AUDIT.read_bytes()):
        raise ValueError('Frozen source/protocol/audit changed')
    if frozen['model_sha256'] != digest((directory/'models.joblib').read_bytes()) or audit() != read(AUDIT):
        raise ValueError('Frozen model or parent input changed')
    parent = ROOT/'artifacts/classification-runs'/cfg['parent_run']; meta = read(parent/'metadata.json')
    bundles = joblib.load(directory/'models.joblib')
    expected = {f'{v}:{m}' for v in cfg['variants'] for m in cfg['models']}
    if set(bundles) != expected or set(frozen['thresholds']) != expected:
        raise ValueError('Missing experiment arm')
    cal = load_development('calibration', parent, meta)
    for key, b in bundles.items():
        if b['columns'] != columns(meta['features'], cfg, key.split(':')[0]):
            raise ValueError('Input columns changed')
        raw = b['model'].predict_proba(cal['x'][:, b['columns']])[:, 1]
        assert_close(choose_threshold(cal['y'], b['calibrator'].predict_proba(logit(raw))[:, 1]), frozen['thresholds'][key])
    rows = predict_rows(bundles, load_development('validation', parent, meta))
    assert_close(rows, read(directory/'validation-rows.json'))
    result = summaries(rows, frozen['thresholds'], cfg)
    assert_close(result, read(directory/'result.json'))
    payload = {'schema': cfg['version'], **frozen, 'parent_run': cfg['parent_run'], 'protocol': cfg,
        'audit': read(AUDIT), 'rows': rows, 'result': result,
        'notice': 'Hopkins, M., Reeber, E., Forman, G., & Suermondt, J. (1999). Spambase. UCI Machine Learning Repository. DOI: 10.24432/C53G6X. CC BY 4.0. Adapted feature subsets and classification experiments; no endorsement.'}
    target = directory/'case.json'
    if target.exists():
        assert_close(payload, read(target))
    else:
        write(target, payload)
    sha = digest(target.read_bytes()); EXPORT.mkdir(parents=True, exist_ok=True)
    (EXPORT/f'{sha}.json').write_bytes(target.read_bytes())
    write(EXPORT/'manifest.json', {'path': f'{sha}.json', 'sha256': sha, 'run_id': frozen['run_id'], 'parent_run': cfg['parent_run']})
    record = {'sha256': sha, 'run_id': frozen['run_id'], 'parent_run': cfg['parent_run'], 'protocol_sha256': frozen['protocol_sha256'],
        'summary': {'rows': len(rows), 'models': {k: {'ap': v['calibrated']['ap'], 'brier': v['calibrated']['brier'],
            'capacity': v['capacity'], 'policy': v['policy']} for k, v in result['models'].items()}, 'pairs': result['pairs']}}
    if RECORD.exists():
        assert_close(record, read(RECORD))
    else:
        write(RECORD, record)
    print(f"Verified {frozen['run_id']}: {len(rows)} known development rows, {len(bundles)} fits; no test access")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['run', 'verify'])
    args = parser.parse_args()
    run() if args.action == 'run' else verify()

"""Offline M5 CPU pilot with immutable development selection and test access log."""
import argparse
import gc
import importlib.metadata
import json
import platform
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
import lightgbm as lgb
import numpy as np

from .m5_data import ROOT, RAW, digest, load, revenue_at, write
from .m5_features import baselines, make_features
from .m5_metrics import WRMSSE

HERE = Path(__file__).resolve().parent
RUNS = ROOT / 'artifacts/competition-runs'


def source_hashes():
    paths = list(HERE.glob('m5_*.py')) + [HERE / 'm5-config.json', HERE / 'sources.json', ROOT / 'uv.lock']
    return {str(p.relative_to(ROOT)): digest(p) for p in sorted(paths)}


def data_manifest():
    manifest = json.loads((RAW / 'manifest.json').read_text())
    for name, expected in manifest['files'].items():
        if digest(RAW / name) != expected:
            raise ValueError(f'data modified: {name}')
    return manifest


def train_predict(run, config, metadata, history, calendar, prices, origin):
    start = time.perf_counter()
    print(f'origin {origin}: constructing leakage-safe features', flush=True)
    x, y, train, forecast, cats = make_features(metadata, history, calendar, prices, origin, config['training_window'])
    preparation = time.perf_counter() - start
    fit_start = time.perf_counter()
    dataset = lgb.Dataset(x.loc[train], label=y[train], categorical_feature=cats, free_raw_data=True)

    def progress(env):
        if (env.iteration + 1) % 200 == 0:
            print(f'origin {origin}: tree {env.iteration + 1}/{config["rounds"]}', flush=True)

    model = lgb.train(config['params'], dataset, num_boost_round=config['rounds'], callbacks=[progress])
    fit_seconds = time.perf_counter() - fit_start
    start = time.perf_counter()
    pred = np.maximum(model.predict(x.loc[forecast], num_threads=2), 0).reshape(len(metadata), 28)
    predict_seconds = time.perf_counter() - start
    model.save_model(str(run / f'model-{origin}.txt'))
    importance = sorted(zip(model.feature_name(), model.feature_importance(importance_type='gain').tolist()), key=lambda p: -p[1])
    info = {'feature_count': x.shape[1], 'train_rows': int(train.sum()),
            'feature_seconds': preparation, 'fit_seconds': fit_seconds, 'predict_seconds': predict_seconds,
            'feature_gain': [{'feature': name, 'gain': value} for name, value in importance],
            'feature_gain_note': 'Training split gain; not causal importance or feature-ablation evidence.'}
    del x, y, dataset, model
    gc.collect()
    return pred, info


def checksum_run(run):
    write(run / 'checksums.json', {str(p.relative_to(run)): digest(p) for p in sorted(run.rglob('*'))
                                  if p.is_file() and p.name != 'checksums.json'})


def develop():
    config = json.loads((HERE / 'm5-config.json').read_text())
    manifest = data_manifest()
    run = RUNS / ('m5-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    run.mkdir(parents=True)
    hashes = source_hashes()
    for relative in hashes:
        dest = run / 'source' / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, dest)
    write(run / 'protocol.json', config)
    write(run / 'inputs.json', {'data': manifest, 'source': hashes,
          'python': platform.python_version(), 'platform': platform.platform(),
          'git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
          'dependencies': {name: importlib.metadata.version(name) for name in ['lightgbm','numpy','pandas']}})
    print(f'RUN {run.name}', flush=True)
    metadata, all_sales, calendar, prices = load(config['store'], max(config['validation_origins']) + 28)
    metadata.to_csv(run / 'cohort.csv', index=False)
    rows = []
    for origin in config['validation_origins']:
        history = all_sales[:, :origin].copy()
        predictions = baselines(history)
        predictions['lgbm_tweedie_core'], cost = train_predict(run, config, metadata, history, calendar, prices, origin)
        actual = all_sales[:, origin:origin + 28]
        evaluator = WRMSSE(metadata, history, revenue_at(history, prices, origin))
        fold = {'origin': origin, 'n_series': len(metadata), 'models': {}, 'cost': cost}
        for model, prediction in predictions.items():
            fold['models'][model] = evaluator.score(actual, prediction)
        np.savez_compressed(run / f'predictions-{origin}.npz', actual=actual, **predictions)
        write(run / f'fold-{origin}.json', fold)
        rows.append(fold)
        print(json.dumps({'origin': origin, 'scores': {m: v['scope_wrmsse'] for m, v in fold['models'].items()}}), flush=True)
    means = {model: float(np.mean([r['models'][model]['scope_wrmsse'] for r in rows])) for model in config['models']}
    winner = min(means, key=means.get)
    selection = {'winner': winner, 'metric': 'mean_development_scope_wrmsse', 'scores': means,
                 'config_sha256': digest(run / 'protocol.json'),
                 'fold_sha256': {f'fold-{o}.json': digest(run / f'fold-{o}.json') for o in config['validation_origins']},
                 'frozen_at': datetime.now(timezone.utc).isoformat(), 'test_accessed': False}
    write(run / 'selection.json', selection)
    report = {'run_id': run.name, 'status': 'development_complete_test_sealed', 'config': config,
              'series': len(metadata), 'folds': rows, 'selection': selection,
              'official_champion_score': None, 'leaderboard_comparable': False, 'public_export_allowed': False,
              'evidence': 'Local research; reduced one-store champion-inspired core; no full champion reproduction claim.'}
    write(run / 'report.json', report)
    checksum_run(run)
    write(ROOT / 'artifacts/competition-m5.json', {'run_id': run.name, 'report_sha256': digest(run / 'report.json')})
    print(json.dumps(selection, indent=2), flush=True)
    return run


def final(run_id):
    if not run_id or Path(run_id).name != run_id or not run_id.startswith('m5-'):
        raise ValueError('provide saved M5 run id')
    run = RUNS / run_id
    from .m5_verify import verify
    verify(run)
    inputs = json.loads((run / 'inputs.json').read_text())
    if source_hashes() != inputs['source'] or data_manifest() != inputs['data']:
        raise ValueError('code/data changed since selection: cannot access reserved labels')
    config = json.loads((run / 'protocol.json').read_text())
    selection = json.loads((run / 'selection.json').read_text())
    origin = config['sealed_origin']
    # Fixed ledger key does not depend on run/config version, so a new run cannot reset access.
    ledger = RUNS / f'm5-access-{config["store"]}-{origin}.json'
    if ledger.exists():
        raise ValueError(f'test access already consumed; use saved final report: {ledger}')
    metadata, history, calendar, prices = load(config['store'], origin)
    predictions = baselines(history)
    cost = None
    if selection['winner'] == 'lgbm_tweedie_core':
        predictions['lgbm_tweedie_core'], cost = train_predict(run, config, metadata, history, calendar, prices, origin)
    np.savez_compressed(run / 'reserved-predictions.npz', **predictions)
    access = {'run_id': run_id, 'origin': origin, 'status': 'consumed', 'opened_at': datetime.now(timezone.utc).isoformat(),
              'selection_sha256': digest(run / 'selection.json'), 'predictions_sha256': digest(run / 'reserved-predictions.npz')}
    # Exclusive creation: record access BEFORE any reserved label read, even on failure.
    with ledger.open('x') as f:
        json.dump(access, f, indent=2)
    write(run / 'test-access.json', access)
    final_meta, observed, _, _ = load(config['store'], origin + 28)
    if not metadata.equals(final_meta):
        raise ValueError('reserved cohort alignment changed')
    actual = observed[:, origin:origin + 28]
    evaluator = WRMSSE(metadata, history, revenue_at(history, prices, origin))
    results = {m: evaluator.score(actual, p) for m, p in predictions.items()}
    np.savez_compressed(run / 'reserved-actual.npz', actual=actual)
    final_report = {'origin': origin, 'models': results, 'selected_model': selection['winner'], 'cost': cost,
                    'label_status': 'consumed_no_further_selection',
                    'evidence': 'Project-reserved public competition validation; not official private-test leaderboard score.'}
    write(run / 'final.json', final_report)
    report = json.loads((run / 'report.json').read_text())
    report['status'] = 'complete_reserved_window_consumed'
    report['final'] = final_report
    write(run / 'report.json', report)
    checksum_run(run)
    write(ROOT / 'artifacts/competition-m5.json', {'run_id': run_id, 'report_sha256': digest(run / 'report.json')})
    print(json.dumps(final_report, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['develop', 'final'])
    parser.add_argument('--run-id')
    args = parser.parse_args()
    develop() if args.stage == 'develop' else final(args.run_id)

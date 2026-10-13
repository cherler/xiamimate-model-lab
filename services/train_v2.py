"""Round two: CPU-only rolling development validation, atomic artifact publication."""
from __future__ import annotations
import os
# Set before numpy / OpenMP loads. Never consumes a GPU or cloud account.
for variable in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS']:
    os.environ[variable] = '2'
import hashlib
import itertools
import json
import platform
import shutil
import threading
import time
from datetime import datetime, timezone
from importlib.metadata import version
import numpy as np
import pandas as pd
import psutil
from scipy import sparse
from prepare_data import ROOT, prepare
from ml.core import build_itemcf, next_baskets
from ml.recommenders import STRATEGIES, interaction_matrix, fit_als, fit_ease, evaluate, latency
from ml.forecasting_v2 import train_forecasts


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False))


class Resources:
    """Sample total process-tree RSS; this is not incremental model-only memory."""
    def __enter__(self):
        self.started = time.perf_counter(); self.peak = 0; self.stop = threading.Event()
        def sample():
            while not self.stop.is_set():
                try:
                    process = psutil.Process()
                    self.peak = max(self.peak, sum(p.memory_info().rss for p in [process, *process.children(recursive=True)] if p.is_running()))
                except psutil.Error:
                    pass
                self.stop.wait(.05)
        self.worker = threading.Thread(target=sample, daemon=True); self.worker.start()
        return self

    def __exit__(self, *args):
        self.stop.set(); self.worker.join()
        self.result = {'training_seconds': time.perf_counter() - self.started, 'sampled_process_tree_peak_rss_mb': self.peak / 2**20}


def mean_windows(windows):
    return {key: float(np.mean([w[key] for w in windows])) for key in ['recall', 'ndcg', 'hit_rate', 'catalog_coverage', 'target_catalog_coverage']}


def main():
    begun = time.perf_counter()
    config = json.loads((ROOT / 'services/configs/round2.json').read_text())
    run_id = datetime.now(timezone.utc).strftime('retail-%Y%m%dT%H%M%SZ')
    run = ROOT / 'artifacts/runs' / run_id; run.mkdir(parents=True)
    write_json(run / 'config.json', config)
    data, audit = prepare(); write_json(run / 'data-audit.json', audit)
    rec = data[data.customer.notna()].copy()
    als_config = config['recommendation']['als']
    grid = {'als': [dict(factors=f, regularization=r, confidence_increment=c, iterations=als_config['iterations']) for f, r, c in itertools.product(als_config['factors'], als_config['regularization'], als_config['confidence_increment'])], 'ease': [{'regularization': r} for r in config['recommendation']['ease']['regularization']]}
    candidates = {name: [{'params': p, 'windows': [], 'resources': [], 'records': []} for p in params] for name, params in grid.items()}
    fixed = {name: {'windows': [], 'records': [], 'resources': []} for name in STRATEGIES[:3]}
    windows = []
    for origin in config['origins']:
        end = str((pd.Timestamp(origin) + pd.offsets.MonthBegin()).date())
        train = rec[rec.date < origin]
        assert train.date.max() < pd.Timestamp(origin)
        print(f'Recommendation window {origin}, train={len(train):,}', flush=True)
        with Resources() as resources:
            model = build_itemcf(train, **config['recommendation']['itemcf'])
        users, x = interaction_matrix(model)
        model['users'] = users
        model['_user_index'] = {s: i for i, s in enumerate(users)}
        model['_item_index'] = {s: i for i, s in enumerate(model['items'])}
        targets = next_baskets(rec, origin, end)
        windows.append({'origin': origin, 'end_exclusive': end, 'training_rows': len(train), 'training_users': len(users), 'catalog_items': len(model['items']), 'last_training_event': str(train.date.max()), 'users': len(targets)})
        for name in fixed:
            metrics, records = evaluate(model, targets, name)
            fixed[name]['windows'].append(metrics); fixed[name]['records'].append(records)
            fixed[name]['resources'].append(resources.result if name != 'popular' else {'training_seconds': None, 'sampled_process_tree_peak_rss_mb': None})
        for name, entries in candidates.items():
            for entry in entries:
                with Resources() as measured:
                    if name == 'als':
                        model.update(fit_als(x, entry['params'], config['seed'], config['threads']))
                    else:
                        model['ease_weights'] = fit_ease(x, **entry['params'])
                metrics, records = evaluate(model, targets, name)
                entry['windows'].append(metrics); entry['records'].append(records); entry['resources'].append(measured.result)
                print(f"  {name} {entry['params']} NDCG={metrics['ndcg']:.5f}", flush=True)
        model.pop('ease_weights', None)
    chosen = {name: max(entries, key=lambda e: mean_windows(e['windows'])['ndcg']) for name, entries in candidates.items()}
    final_params = {name: entry['params'] for name, entry in chosen.items()}
    print(f'Selected on development windows: {final_params}', flush=True)
    combined = {**fixed, **chosen}
    summaries = {}
    for name, entry in combined.items():
        summaries[name] = {'metrics': mean_windows(entry['windows']), 'windows': [dict(origin=origin, **m) for origin, m in zip(config['origins'], entry['windows'])], 'resources': entry['resources'], 'user_windows': sum(m['users'] for m in entry['windows']), 'unique_customers': len({r['customer'] for group in entry['records'] for r in group})}
        rows = [{'origin': origin, **r, 'target': json.dumps(r['target']), 'ranked': json.dumps(r['ranked'])} for origin, group in zip(config['origins'], entry['records']) for r in group]
        pd.DataFrame(rows).to_csv(run / f'validation-predictions-{name}.csv.gz', index=False)
    # The final origin powers the live demo; earlier windows remain genuine frozen predictions.
    model.update(fit_als(x, final_params['als'], config['seed'], config['threads']))
    model['ease_weights'] = fit_ease(x, **final_params['ease'])
    model['as_of'] = config['origins'][-1]
    stability = []
    original_factors = {key: model[key].copy() for key in ['user_factors', 'item_factors']}
    for seed in config['recommendation']['stability_seeds']:
        factors = fit_als(x, final_params['als'], seed, config['threads'])
        model.update(factors)
        metrics, _ = evaluate(model, targets, 'als')
        stability.append({'seed': seed, 'origin': model['as_of'], 'metrics': metrics, 'factor_max_difference_from_seed42': max(float(np.max(np.abs(factors[key] - original_factors[key]))) for key in factors) if seed == 42 else None})
    model.update(original_factors)
    sparse.save_npz(run / 'itemcf.npz', model['matrix'])
    np.save(run / 'popularity.npy', model['popularity'], allow_pickle=False)
    np.savez(run / 'als.npz', user_factors=model['user_factors'], item_factors=model['item_factors'])
    np.save(run / 'ease.npy', model['ease_weights'], allow_pickle=False)
    eligible = sorted(user for user, history in model['histories'].items() if len(history) >= 3)
    model['demo_users'] = sorted(np.random.default_rng(config['seed']).choice(eligible, min(24, len(eligible)), replace=False).tolist())
    model['run_id'] = run_id; model['schema_version'] = 2; model['selected_params'] = final_params
    for name in STRATEGIES:
        summaries[name]['latency'] = latency(model, name, eligible)
        artifact_names = ['popularity.npy'] if name == 'popular' else ['itemcf.npz'] if name in ['itemcf', 'basket'] else ['als.npz'] if name == 'als' else ['ease.npy']
        summaries[name]['model_bytes'] = sum((run / f).stat().st_size for f in artifact_names)
    omitted = ['matrix', 'popularity', 'ease_weights', 'user_factors', 'item_factors', '_user_index', '_item_index']
    write_json(run / 'model.json', {k: v for k, v in model.items() if k not in omitted})
    profiles = {}
    for user in model['demo_users']:
        rows = train[train.customer == user].sort_values('date').drop_duplicates('item', keep='last').tail(6)
        profiles[user] = [{'id': row['item'], 'name': row['name'], 'date': str(row['date']), 'quantity': float(row['quantity'])} for _, row in rows.iterrows()]
    write_json(run / 'profiles.json', profiles)
    recommendation = {'models': summaries, 'default_model': max(summaries, key=lambda name: summaries[name]['metrics']['ndcg']), 'windows': windows, 'selected_params': final_params, 'candidates': {name: [{k: v for k, v in entry.items() if k != 'records'} for entry in entries] for name, entries in candidates.items()}, 'seed_stability': stability, 'aggregation': 'Equal-weight mean of window metrics, each window averages customers; users are counted as customer-window events.', 'task': 'First basket in the following calendar month, full training catalog, Top 10, repeat purchases allowed, no within-window updates; OOV targets remain misses.', 'memory_scope': 'Sampled total process-tree RSS, including loaded data and other models; not incremental model memory. ItemCF and basket share one fit. Popularity computed during shared preparation; isolated fit cost unavailable.'}
    del candidates, combined, fixed, model, x
    with Resources() as forecast_resources:
        forecast = train_forecasts(data, run, config)
    forecast['resources'] = forecast_resources.result
    report = {'schema_version': 2, 'run_id': run_id, 'generated_at': datetime.now(timezone.utc).isoformat(), 'data_origin': 'public', 'evidence_level': 'development_validation', 'dataset': 'UCI Online Retail II', 'source': audit, 'config': config, 'recommendation': recommendation, 'forecast': forecast, 'limitations': ['The same rolling development windows select hyperparameters and compare models; no independent unseen test claim.', 'Earlier experiments already exposed October/November labels. Only 13 complete days remain after the prior 28-day tests; a new 28-day independent holdout is unavailable.', 'Offline ranking/forecast errors are not causal business, revenue, or inventory gains.'], 'environment': {'python': platform.python_version(), 'platform': platform.platform(), 'machine': platform.machine(), 'cpu_count': os.cpu_count(), 'threads': config['threads'], 'device': 'CPU', 'packages': {name: version(name) for name in ['numpy', 'pandas', 'scipy', 'scikit-learn', 'implicit', 'lightgbm', 'statsforecast', 'psutil']}}}
    sources = [ROOT / 'services/train_v2.py', ROOT / 'services/prepare_data.py', *sorted((ROOT / 'services/ml').glob('*.py')), ROOT / 'services/configs/round2.json', ROOT / 'pyproject.toml', ROOT / 'uv.lock']
    report['code_sha256'] = {}
    for path in sources:
        dest = run / 'source' / path.relative_to(ROOT); dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(path, dest)
        report['code_sha256'][str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    report['duration_seconds'] = round(time.perf_counter() - begun, 2)
    write_json(run / 'report.json', report)
    write_json(run / 'checksums.json', {str(p.relative_to(run)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(run.rglob('*')) if p.is_file()})
    temp = ROOT / 'artifacts/latest.json.tmp'; write_json(temp, {'run_id': run_id}); temp.replace(ROOT / 'artifacts/latest.json')
    print(f'Complete: {run_id}, {report["duration_seconds"]}s', flush=True)


if __name__ == '__main__':
    main()

"""Export versioned, read-only displays from saved experiments; never train or open labels."""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
from datetime import date, timedelta
from scipy import sparse
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services'))
from ml.core import ranking_metrics
from ml.tafeng import summarize_ranking
from ml.forecasting import forecast_metrics
import numpy as np

TAFENG = 'final-20261012T010749Z'
UCI = 'retail-20261012T001149Z'
TAFENG_DISPLAY = TAFENG + '-display-v2'
SEED = 'showcase-v1-seed42'


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')


def verify_files(run):
    checksums = read(run / 'checksums.json')
    for name, expected in checksums.items():
        path = (run / name).resolve()
        if not path.is_relative_to(run.resolve()) or sha(path) != expected:
            raise ValueError(f'Invalid artifact: {name}')
    return checksums


def stable_sample(users, count):
    return sorted(users, key=lambda u: hashlib.sha256(f'{SEED}:{u}'.encode()).hexdigest())[:count]


def equal(actual, expected):
    if isinstance(expected, dict):
        if actual.keys() != expected.keys():
            raise ValueError('Summary keys differ')
        for key in expected:
            equal(actual[key], expected[key])
    elif expected is None:
        if actual is not None:
            raise ValueError('Expected undefined metric')
    elif not np.isclose(actual, expected, rtol=1e-10, atol=1e-12):
        raise ValueError(f'Metric mismatch: {actual} != {expected}')


def records(path):
    with gzip.open(path, 'rt') as f:
        return list(csv.DictReader(f))


def export_tafeng(run, dest):
    sums = verify_files(run)
    report = read(run / 'report.json')
    if report['run_id'] != TAFENG or report['phase'] != 'final':
        raise ValueError('Expected fixed final experiment')
    meta = read(run / 'recommendation-model/metadata.json')
    # Select before consulting any outcomes, including whether a customer returned.
    warm = stable_sample(meta['users'], 24)
    frequency = sparse.load_npz(run / 'recommendation-model/frequency.npz')
    recent = sparse.load_npz(run / 'recommendation-model/recent.npz')
    user_index = {u: i for i, u in enumerate(meta['users'])}
    item_index = {s: i for i, s in enumerate(meta['items'])}
    cold = None
    samples = {u: {'customer': u, 'cohort': 'warm', 'history': meta['histories'][u], 'tasks': {}} for u in warm}
    for u, sample in samples.items():
        sample['behavior'] = {}
        for item in sample['history']:
            if item not in item_index:
                sample['behavior'][item] = None  # Historical item outside the model catalog.
                continue
            i, j = user_index[u], item_index[item]
            value = float(recent[i, j])
            days = round(1 / value - 1) if value > 0 else None
            count = int(frequency[i, j])
            if days is None or days < 1 or count < 1:
                raise ValueError('Invalid saved purchase history')
            sample['behavior'][item] = {'purchase_days': count, 'days_since_last': days,
                'last_purchase_date': str(date.fromisoformat(meta['origin']) - timedelta(days=days))}
    for task, models in report['recommendation'].items():
        for name, summary in models.items():
            rows = records(run / f'{task}-{name}.csv.gz')
            parsed = []
            for row in rows:
                for field in ['target', 'ranked']:
                    row[field] = json.loads(row[field])
                for field in ['candidate_count', 'target_count', 'oov_targets']:
                    row[field] = int(row[field])
                for field in ['ndcg', 'recall', 'precision', 'hit_rate']:
                    row[field] = float(row[field]) if row[field] else None
                metrics = ranking_metrics(row['ranked'], set(row['target']))
                equal(row['ndcg'], metrics['ndcg'])
                equal(row['recall'], metrics['recall'] if row['target'] else None)
                equal(row['precision'], len(set(row['ranked']) & set(row['target'])) / 10)
                equal(row['hit_rate'], metrics['hit_rate'])
                history = set(meta['histories'].get(row['customer'], []))
                ranked = set(row['ranked'])
                if len(ranked) != len(row['ranked']) or len(ranked) > 10:
                    raise ValueError('Invalid top 10')
                if (task == 'repurchase' and not ranked <= history) or (task == 'discovery' and ranked & history):
                    raise ValueError('Task candidate mismatch')
                parsed.append(row)
            equal(summarize_ranking(parsed, len(meta['items']), task), summary)
            if cold is None:
                cold = stable_sample([r['customer'] for r in parsed if r['cohort'] == 'cold'], 3)
                samples.update({u: {'customer': u, 'cohort': 'cold', 'history': [], 'behavior': {}, 'tasks': {}} for u in cold})
            for row in parsed:
                if row['customer'] in samples:
                    samples[row['customer']]['tasks'].setdefault(task, {})[name] = row
    weekly = records(run / 'weekly-predictions.csv.gz')
    origins = sorted({r['origin'] for r in weekly})
    history = {origin: read(run / f'autoets-{origin}.json')['histories'] for origin in origins}
    series = []
    for row in weekly:
        index = report['forecast_items'].index(row['item'])
        days = history[row['origin']][index][-28:]
        if len(days) != 28:
            raise ValueError('Missing pre-origin history')
        series.append({'origin': row['origin'], 'item': row['item'], 'actual': float(row['actual']),
                       'past_weeks': [sum(days[i:i+7]) for i in range(0, 28, 7)],
                       'predictions': {name: float(row[name]) for name in report['weekly']}})
    if len(series) != report['forecast_rows'] or len({(r['origin'], r['item']) for r in series}) != len(series):
        raise ValueError('Forecast coverage mismatch')
    for name, entry in report['weekly'].items():
        equal(forecast_metrics([r['actual'] for r in series], [r['predictions'][name] for r in series]), entry['metrics'])
        for window in entry['windows']:
            part = [r for r in series if r['origin'] == window['origin']]
            equal(forecast_metrics([r['actual'] for r in part], [r['predictions'][name] for r in part]), {k: v for k, v in window.items() if k != 'origin'})
    write(dest / 'report.json', report)
    write(dest / 'recommendations.json', {
        'run_id': TAFENG, 'origin': report['origin'], 'end_exclusive': report['end_exclusive'],
        'sampling': {'seed': SEED, 'warm': '24 training customers selected by ID hash before reading outcomes; non-returners retained without scored outputs',
                     'cold': '3 ID-hash samples from the observed cold cohort; illustrative post-period cohort selection'},
        'samples': list(samples.values())})
    write(dest / 'weekly.json', {'run_id': TAFENG, 'items': report['forecast_items'], 'origins': origins, 'series': series})
    shutil.copyfile(run / 'weekly-predictions.csv.gz', dest / 'weekly-predictions.csv.gz')
    return sums['report.json']


def export(root=ROOT):
    output = root / 'apps/web/showcase'
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='showcase-', dir=output.parent) as temp:
        staged = Path(temp)
        ta = root / 'artifacts/tafeng-runs' / TAFENG
        uc = root / 'artifacts/runs' / UCI
        ta_sha = export_tafeng(ta, staged / TAFENG_DISPLAY)
        uc_sums = verify_files(uc)
        for name in ['report.json', 'forecast-series.json', 'weekly-series.json', 'diagnostics.json']:
            write(staged / UCI / name, read(uc / name))
        manifest = {'schema_version': 1, 'default_case': 'tafeng', 'cases': [
            {'id': 'tafeng', 'label': 'Ta Feng · 独立留出测试', 'dataset': 'Ta Feng', 'run_id': TAFENG,
             'evidence': 'final_holdout', 'mode': 'saved_results', 'tasks': ['repurchase', 'discovery', 'weekly_sales'],
             'report_sha256': ta_sha, 'resources': {key: f'{TAFENG_DISPLAY}/{file}' for key, file in {'report': 'report.json', 'recommendations': 'recommendations.json', 'weekly': 'weekly.json', 'weekly_predictions': 'weekly-predictions.csv.gz'}.items()}},
            {'id': 'uci', 'label': 'UCI · 历史开发验证', 'dataset': 'UCI Online Retail II', 'run_id': UCI,
             'evidence': 'development', 'mode': 'local_api', 'tasks': ['next_basket', 'daily_sales', 'weekly_sales'],
             'report_sha256': uc_sums['report.json'], 'resources': {'report': f'{UCI}/report.json'}}]}
        manifest['metric_definitions'] = {
            'ndcg_at_10': {'unit': 'score', 'direction': 'higher', 'cohort': 'all returning warm customers, empty targets count zero'},
            'conditional_recall_at_10': {'unit': 'ratio', 'direction': 'higher', 'cohort': 'customers with nonempty task targets only'},
            'precision_at_10': {'unit': 'ratio', 'denominator': 10},
            'catalog_coverage': {'unit': 'ratio', 'denominator': 'training catalog'},
            'wape': {'unit': 'ratio', 'formula': 'sum(abs(prediction-actual))/sum(actual)', 'zero_actual': None},
            'bias': {'unit': 'ratio', 'formula': 'sum(prediction-actual)/sum(actual)', 'zero_actual': None},
            'mae': {'unit': 'units per product week for weekly tasks; units per product day for daily tasks'}}
        manifest['files'] = {str(p.relative_to(staged)): sha(p) for p in sorted(staged.rglob('*')) if p.is_file()}
        # A stable version identifies content, never the wall clock.
        manifest['version'] = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:16]
        for run_id in [TAFENG_DISPLAY, UCI]:
            target = output / run_id
            if target.exists():
                previous = {str(p.relative_to(output)): sha(p) for p in target.rglob('*') if p.is_file()}
                expected = {k: v for k, v in manifest['files'].items() if k.startswith(run_id + '/')}
                if previous != expected:
                    raise ValueError('Existing version differs; preserve it and publish a new version')
            else:
                shutil.move(str(staged / run_id), target)
        write(output / 'manifest.json.tmp', manifest)
        (output / 'manifest.json.tmp').replace(output / 'manifest.json')
    print(f"Showcase {manifest['version']}: verified saved results; no training or sealed-source access")
    return manifest


if __name__ == '__main__':
    argparse.ArgumentParser(description=__doc__).parse_args()
    export()

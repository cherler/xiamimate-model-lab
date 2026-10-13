"""Independent artifact audit after a full training run; fails rather than trusting UI numbers."""
import os
for key in ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"]:
    os.environ[key] = "2"
import runpy
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services'))
from server import Artifacts
from ml.core import ranking_metrics, rank_items
from ml.forecasting import features, forecast_metrics

store = Artifacts().load()
run, report = store.run, store.report
if report.get('schema_version') == 3:
    runpy.run_path(str(Path(__file__).with_name('verify-v3.py')), run_name='__main__')
    sys.exit(0)
if report.get('schema_version') == 2:
    runpy.run_path(str(Path(__file__).with_name('verify-v2.py')), run_name='__main__')
    sys.exit(0)
for name, digest in json.loads((run / 'checksums.json').read_text()).items():
    assert hashlib.sha256((run / name).read_bytes()).hexdigest() == digest, name
assert report['source']['raw_rows'] == report['source']['clean_rows'] + sum(x['rows'] for x in report['source']['removed'])
assert pd.Timestamp(report['training']['last_event']) < pd.Timestamp(report['config']['test_start'])
for strategy in ['popular', 'itemcf', 'basket']:
    rows = pd.read_csv(run / f'test-predictions-{strategy}.csv.gz', dtype={'customer':str})
    recomputed = []
    for row in rows.to_dict('records'):
        target, ranked = set(json.loads(row['target'])), json.loads(row['ranked'])
        metrics = ranking_metrics(ranked, target, 10)
        for key, value in metrics.items():
            assert abs(value - row[key]) < 1e-10
        recomputed.append(metrics)
        # Replay the persisted matrix and verify every saved recommendation.
        indices, _, _ = rank_items(store.model, row['customer'], strategy, 10)
        assert ranked == [store.model['items'][i] for i in indices]
    for key in ['recall','ndcg','hit_rate']:
        assert abs(np.mean([r[key] for r in recomputed]) - report['test'][strategy][key]) < 1e-10
    assert len(rows) == report['test'][strategy]['users']
    print(f'{strategy}: {len(rows)} users replayed; aggregate metrics match.')
f = pd.read_csv(run / 'forecast-predictions.csv.gz', dtype={'item':str})
for key, column in [('baseline','baseline'),('ridge','ridge')]:
    for metric, value in forecast_metrics(f.actual, f[column]).items():
        assert abs(value - report['forecast'][key][metric]) < 1e-10
assert len(f) == report['forecast']['rows_evaluated']
# Reconstruct model forecasts from saved coefficients and only the 56-day history.
items = report['forecast']['items']
for series in store.forecast:
    params = np.load(run / f"forecast-ridge-{series['origin']}.npz", allow_pickle=False)
    dates = pd.to_datetime(series['history_dates'] + series['dates'])
    values = np.array(series['history'] + [0] * 28)
    x = np.array([features(values, dates,56,h,items.index(series['item']),len(items)) for h in range(1,29)])
    replay = np.maximum(0,np.expm1(((x-params['mean'])/params['scale']) @ params['coef'] + params['intercept']))
    np.testing.assert_allclose(replay, series['prediction'], atol=1e-6, rtol=1e-8)
    np.testing.assert_array_equal(series['baseline'], np.tile(series['history'][-7:],4))
print(f'Forecast: {len(f)} product-days verified; saved coefficients reproduce every curve.')
print(f'All checks passed: {report["run_id"]}')

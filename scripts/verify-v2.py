"""Rebuild selected models and recompute metrics from real source data + saved predictions."""
import os
for key in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS']:
    os.environ[key] = '2'
import hashlib
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services'))
import numpy as np
import pandas as pd
from lightgbm import Booster, LGBMRegressor
from server import Artifacts
from prepare_data import prepare
from ml.core import build_itemcf, next_baskets, ranking_metrics
from ml.recommenders import STRATEGIES, interaction_matrix, fit_als, fit_ease, rank_items
from ml.forecasting import features, forecast_metrics
from ml.forecasting_v2 import dataset, training_arrays, FEATURE_NAMES

store = Artifacts().load(); run, report = store.run, store.report
assert report['schema_version'] == 2
for name, digest in json.loads((run / 'checksums.json').read_text()).items():
    assert hashlib.sha256((run / name).read_bytes()).hexdigest() == digest, name
source = report['source']
assert source['raw_rows'] == source['clean_rows'] + sum(x['rows'] for x in source['removed'])
data, audit = prepare()
assert audit['input_sha256'] == source['input_sha256']
frames = {name: pd.read_csv(run / f'validation-predictions-{name}.csv.gz', dtype={'customer':str}) for name in STRATEGIES}
rec = report['recommendation']; config = report['config']
for window in rec['windows']:
    origin = window['origin']
    train = data[(data.date < origin) & data.customer.notna()]
    assert str(train.date.max()) == window['last_training_event']
    assert train.date.max() < pd.Timestamp(origin)
    targets = next_baskets(data, origin, window['end_exclusive'])
    if origin == store.model['as_of']:
        model = store.model
    else:
        model = build_itemcf(train, **config['recommendation']['itemcf'])
        users, x = interaction_matrix(model); model['users'] = users
        model.update(fit_als(x, rec['selected_params']['als'], config['seed'], config['threads']))
        model['ease_weights'] = fit_ease(x, **rec['selected_params']['ease'])
    vocabulary = set(model['items'])
    for name in STRATEGIES:
        rows = frames[name][frames[name].origin == origin]
        assert set(rows.customer) == set(targets)
        coverage = set()
        for row in rows.to_dict('records'):
            target, ranked = set(json.loads(row['target'])), json.loads(row['ranked'])
            assert target == targets[row['customer']]
            assert row['oov_targets'] == len(target - vocabulary)
            for key, value in ranking_metrics(ranked, target).items():
                assert abs(value - row[key]) < 1e-10
            indices, _, fallback = rank_items(model, row['customer'], name)
            assert ranked == [model['items'][i] for i in indices], (origin, name, row['customer'])
            assert fallback == row['fallback']
            coverage.update(ranked)
        saved = next(w for w in rec['models'][name]['windows'] if w['origin'] == origin)
        for key in ['recall','ndcg','hit_rate']:
            assert abs(rows[key].mean() - saved[key]) < 1e-10
        assert abs(len(coverage) / len(vocabulary) - saved['catalog_coverage']) < 1e-10
    print(f'Recommendations {origin}: all five models replayed for {len(targets)} customers.', flush=True)
for name, frame in frames.items():
    for key in ['recall','ndcg','hit_rate']:
        assert abs(frame.groupby('origin')[key].mean().mean() - rec['models'][name]['metrics'][key]) < 1e-10
uk, items, dates, values = dataset(data,config)
assert items == report['forecast']['items']
f = pd.read_csv(run / 'forecast-predictions.csv.gz', dtype={'item':str})
assert len(f) == report['forecast']['rows_evaluated']
for name, result in report['forecast']['models'].items():
    for metric, value in forecast_metrics(f.actual, f[name]).items():
        assert abs(value - result['metrics'][metric]) < 1e-10
for origin in config['origins']:
    start = int(dates.get_loc(pd.Timestamp(origin)))
    x, y = training_arrays(values,dates,start)
    estimator = LGBMRegressor(**report['forecast']['selected_params'], learning_rate=.05, min_child_samples=30, reg_lambda=1.0, random_state=config['seed'], n_jobs=config['threads'], deterministic=True, force_col_wise=True, verbosity=-1)
    estimator.fit(x,y,feature_name=FEATURE_NAMES + ['item_' + item for item in items])
    saved = Booster(model_file=str(run / f'forecast-lightgbm-{origin}.txt'))
    ridge = np.load(run / f'forecast-ridge-{origin}.npz', allow_pickle=False)
    for s in [s for s in store.forecast if s['origin'] == origin]:
        i = items.index(s['item'])
        np.testing.assert_array_equal(s['actual'],values[i,start:start+28])
        history = np.array(s['history'] + [0]*28)
        local_dates = pd.to_datetime(s['history_dates'] + s['dates'])
        query = np.array([features(history,local_dates,56,h,i,len(items)) for h in range(1,29)])
        np.testing.assert_allclose(saved.predict(query), s['predictions']['lightgbm'], atol=1e-8)
        np.testing.assert_allclose(estimator.booster_.predict(query), s['predictions']['lightgbm'], atol=1e-8)
        ridge_pred = np.maximum(0,np.expm1(((query-ridge['mean'])/ridge['scale']) @ ridge['coef'] + ridge['intercept']))
        np.testing.assert_allclose(ridge_pred,s['predictions']['ridge'],atol=1e-8)
        np.testing.assert_array_equal(s['predictions']['seasonal'],np.tile(history[49:56],4))
        np.testing.assert_allclose(s['predictions']['weekday_mean'],np.tile(history[28:56].reshape(4,7).mean(axis=0),4))
        subset = f[(f.origin == origin) & (f.item == s['item'])]
        assert list(subset.date) == s['dates']
        for name in report['forecast']['models']:
            np.testing.assert_allclose(subset[name],s['predictions'][name],atol=1e-8)
            for metric,value in forecast_metrics(s['actual'],s['predictions'][name]).items():
                assert abs(value-s['metrics'][name][metric])<1e-10
    print(f'Forecast {origin}: LightGBM refit and saved models reproduce all curves.', flush=True)
print(f'All round-two integrity, source-boundary, metric and replay checks passed: {store.run_id}')

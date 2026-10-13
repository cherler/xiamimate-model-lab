"""Frozen rolling development comparison of six CPU forecasting families."""
from __future__ import annotations
import json
import subprocess
import sys
import time
from pathlib import Path
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from ml.forecasting import features, training_origins, forecast_metrics

LABELS = {'seasonal': '上周同期', 'weekday_mean': '近四周同星期均值', 'ridge': 'Ridge', 'autoets': 'AutoETS', 'autoarima': 'AutoARIMA', 'lightgbm': 'LightGBM'}
FEATURE_NAMES = ['log_lag_1', 'log_lag_7', 'log_lag_14', 'log_lag_28', 'log_mean_7', 'log_mean_28', 'log_mean_56', 'log_std_28', 'horizon', 'weekday_sin', 'weekday_cos', 'month_sin', 'month_cos']


def dataset(data, config):
    uk = data[data.country == 'United Kingdom'].copy()
    uk['day'] = uk.date.dt.normalize()
    before = uk[uk.day < config['origins'][0]]
    ranked = before.groupby('item').agg(active_days=('day', 'nunique'), units=('quantity', 'sum'))
    selected = ranked[ranked.active_days >= config['forecast']['minimum_active_days']].sort_values('units', ascending=False, kind='stable').head(config['forecast']['items']).index.tolist()
    dates = pd.date_range(uk.day.min(), uk.day.max() - pd.Timedelta(days=1))
    daily = uk[uk.item.isin(selected)].groupby(['day', 'item']).quantity.sum().unstack(fill_value=0).reindex(index=dates, columns=selected, fill_value=0).fillna(0)
    return uk, selected, dates, daily.to_numpy(dtype=float).T


def training_arrays(values, dates, stop, horizon=28):
    x, y = [], []
    for i, series in enumerate(values):
        for origin in training_origins(stop, horizon):
            for h in range(1, horizon + 1):
                x.append(features(series, dates, origin, h, i, len(values)))
                y.append(series[origin + h - 1])
    return np.asarray(x), np.asarray(y)


def statistical(name, histories, horizon, timeout):
    request = {'model': name, 'histories': histories, 'horizon': horizon}
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('statistical_worker.py'))], input=json.dumps(request), capture_output=True, text=True, timeout=timeout, check=True)
        return json.loads(result.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError) as error:
        return [{'prediction': None, 'failure': f'{type(error).__name__}: statistical worker failed or exceeded {timeout}s per model/window'} for _ in histories]


def train_forecasts(data, run, config):
    uk, items, dates, values = dataset(data, config)
    horizon = config['forecast']['horizon']
    candidates = [{'objective': objective, 'num_leaves': leaves, 'n_estimators': config['forecast']['lightgbm']['n_estimators']} for objective in config['forecast']['lightgbm']['objectives'] for leaves in config['forecast']['lightgbm']['num_leaves']]
    scores = [{'params': params, 'windows': [], 'training_seconds': 0.0} for params in candidates]
    all_actual, cache, windows, fallbacks = [], [], [], []
    times = {name: 0.0 for name in LABELS}
    feature_names = FEATURE_NAMES + ['item_' + item for item in items]
    for origin in config['origins']:
        print(f'Forecast window {origin}: constructing history-only features', flush=True)
        start = int(dates.get_loc(pd.Timestamp(origin)))
        assert start + horizon <= len(dates)
        x, y = training_arrays(values, dates, start, horizon)
        query = np.array([features(s, dates, start, h, i, len(items)) for i, s in enumerate(values) for h in range(1, horizon + 1)])
        actual = values[:, start:start + horizon]
        pred, model_files = {}, {}
        begun = time.perf_counter(); pred['seasonal'] = np.tile(values[:, start - 7:start], (1, horizon // 7)); times['seasonal'] += time.perf_counter() - begun
        begun = time.perf_counter(); pred['weekday_mean'] = np.tile(values[:, start - 28:start].reshape(len(items), 4, 7).mean(axis=1), (1, horizon // 7)); times['weekday_mean'] += time.perf_counter() - begun
        begun = time.perf_counter()
        ridge = make_pipeline(StandardScaler(), Ridge(alpha=1.0)).fit(x, np.log1p(y))
        times['ridge'] += time.perf_counter() - begun
        pred['ridge'] = np.maximum(0, np.expm1(ridge.predict(query))).reshape(actual.shape)
        scaler, fitted = ridge.steps[0][1], ridge.steps[1][1]
        np.savez(run / f'forecast-ridge-{origin}.npz', mean=scaler.mean_, scale=scaler.scale_, coef=fitted.coef_, intercept=fitted.intercept_)
        for name in ['autoets', 'autoarima']:
            print(f'  {name} / {origin}', flush=True)
            begun = time.perf_counter()
            histories = values[:, :start].tolist()
            result = statistical(name, histories, horizon, config['forecast']['statistical_timeout_seconds'])
            times[name] += time.perf_counter() - begun
            prediction = []
            for i, row in enumerate(result):
                if row['failure']:
                    fallbacks.append({'model': name, 'origin': origin, 'item': items[i], 'reason': row['failure'], 'fallback': 'seasonal'})
                prediction.append(row['prediction'] if row['prediction'] is not None else pred['seasonal'][i].tolist())
            pred[name] = np.array(prediction)
            (run / f'forecast-{name}-{origin}.json').write_text(json.dumps({'model': name, 'horizon': horizon, 'histories': histories, 'result': result}, allow_nan=False))
        lgbm_models, lgbm_predictions = [], []
        for candidate, score in zip(candidates, scores):
            begun = time.perf_counter()
            estimator = LGBMRegressor(**candidate, learning_rate=.05, min_child_samples=30, reg_lambda=1.0, random_state=config['seed'], n_jobs=config['threads'], deterministic=True, force_col_wise=True, verbosity=-1)
            estimator.fit(x, y, feature_name=feature_names)
            seconds = time.perf_counter() - begun
            prediction = np.maximum(0, estimator.booster_.predict(query)).reshape(actual.shape)
            score['training_seconds'] += seconds
            score['windows'].append({'origin': origin, **forecast_metrics(actual, prediction)})
            lgbm_models.append(estimator); lgbm_predictions.append(prediction)
        cache.append((origin, start, actual, pred, lgbm_models, lgbm_predictions, query))
        all_actual.extend(actual.ravel())
        windows.append({'origin': origin, 'end': str(dates[start + horizon - 1].date()), 'training_examples': len(x), 'last_label_before': origin})
    for i, score in enumerate(scores):
        score['metrics'] = forecast_metrics(all_actual, np.concatenate([entry[5][i].ravel() for entry in cache]))
    best = min(range(len(scores)), key=lambda i: scores[i]['metrics']['wape'])
    times['lightgbm'] = scores[best]['training_seconds']
    series_output, rows, aggregate = [], [], {name: [] for name in LABELS}
    importances = []
    replay_error = 0.0
    for window, entry in zip(windows, cache):
        origin, start, actual, predictions, estimators, candidates_pred, query = entry
        estimator = estimators[best]
        estimator.booster_.save_model(str(run / f'forecast-lightgbm-{origin}.txt'))
        from lightgbm import Booster
        reloaded = Booster(model_file=str(run / f'forecast-lightgbm-{origin}.txt'))
        replay_error = max(replay_error, float(np.abs(reloaded.predict(query).reshape(actual.shape) - candidates_pred[best]).max()))
        predictions['lightgbm'] = candidates_pred[best]
        importances.append({'origin': origin, 'gain': dict(zip(feature_names, estimator.booster_.feature_importance(importance_type='gain').tolist()))})
        window['models'] = {name: forecast_metrics(actual, prediction) for name, prediction in predictions.items()}
        for name, prediction in predictions.items():
            aggregate[name].extend(prediction.ravel())
        descriptions = uk[uk.day < origin].sort_values('date').drop_duplicates('item', keep='last').set_index('item')['name'].to_dict()
        for i, item in enumerate(items):
            series_output.append({'item': item, 'name': descriptions.get(item, item), 'origin': origin, 'history_dates': [str(d.date()) for d in dates[start - 56:start]], 'history': values[i, start - 56:start].tolist(), 'dates': [str(d.date()) for d in dates[start:start + horizon]], 'actual': actual[i].tolist(), 'predictions': {name: prediction[i].tolist() for name, prediction in predictions.items()}, 'metrics': {name: forecast_metrics(actual[i], prediction[i]) for name, prediction in predictions.items()}, 'fallback_models': [f['model'] for f in fallbacks if f['origin'] == origin and f['item'] == item]})
            for h in range(horizon):
                rows.append({'item': item, 'origin': origin, 'date': str(dates[start + h].date()), 'actual': actual[i, h], **{name: prediction[i, h] for name, prediction in predictions.items()}})
    pd.DataFrame(rows).to_csv(run / 'forecast-predictions.csv.gz', index=False)
    (run / 'forecast-series.json').write_text(json.dumps(series_output, ensure_ascii=False, allow_nan=False))
    models = {name: {'label': LABELS[name], 'metrics': forecast_metrics(all_actual, aggregate[name]), 'training_seconds': times[name], 'fallback_series': sum(f['model'] == name for f in fallbacks)} for name in LABELS}
    selected = min(models, key=lambda name: models[name]['metrics']['wape'])
    return {'models': models, 'default_model': selected, 'items': items, 'windows': windows, 'rows_evaluated': len(rows), 'candidates': scores, 'selected_params': scores[best]['params'], 'feature_importance': importances, 'fallbacks': fallbacks, 'reload_max_absolute_error': replay_error, 'scope': '12 UK active high-volume SKUs selected before earliest origin; recorded gross positive sales; not latent demand', 'aggregation': 'pooled absolute error / pooled actual volume; MAE per item-day', 'selection_disclosure': 'Same three development windows used for tuning and comparison; not unseen confirmation.', 'ridge_diagnosis': 'log1p target + naive expm1 emphasizes relative/log errors and can underpredict bursts; retained unchanged at alpha=1. LightGBM trains on raw quantity with L2/Poisson/Tweedie objectives.', 'statistical_policy': {'season_length': 7, 'timeout_seconds_per_model_window': config['forecast']['statistical_timeout_seconds'], 'autoarima': {'max_p': 2, 'max_q': 2, 'max_P': 1, 'max_Q': 1, 'max_order': 5, 'nmodels': 20, 'stepwise': True, 'approximation': True}}, 'limitations': ['Missing days filled with zero; closures and missing records indistinguishable.', 'No inventory, promotions, exposure probabilities or calibrated prediction intervals.', 'Stock replenishment is hypothetical; no causal revenue or savings claims.']}

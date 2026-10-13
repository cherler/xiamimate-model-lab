"""Ta Feng shopping-day recommendation and 7-day total forecasting.

All choices live in the development recipe; the evaluation contract is immutable.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from lightgbm import LGBMRegressor

from ml.core import build_itemcf, next_baskets, ranking_metrics
from ml.recommenders import fit_als
from ml.forecasting import forecast_metrics
from ml.forecasting_v2 import statistical
from ml.evaluation_protocol import write_json, require_past_labels

PERSONAL = ['frequency', 'recent', 'decay90', 'decay30', 'interval']
FEATURES = ['log_week_minus4', 'log_week_minus3', 'log_week_minus2', 'log_week_minus1',
            'log_four_week_mean', 'log_four_week_median', 'log_daily_std28', 'log_daily_max28',
            'zero_fraction28', 'zero_fraction7', 'week_trend', 'weekday_sin', 'weekday_cos',
            'month_sin', 'month_cos']


def fit_recommendation(train, origin, recipe, out):
    if train.empty or (train.date >= pd.Timestamp(origin)).any():
        raise ValueError('Recommendation fit received future or empty training data')
    out = Path(out); out.mkdir(parents=True)
    started = time.perf_counter()
    known = train[train.customer.notna()].copy()
    # build_itemcf is reused only for catalog/similarity; full histories below also
    # keep low-support items that never entered the candidate catalog.
    known['name'] = known.item
    model = build_itemcf(known, **recipe['itemcf'])
    users = sorted(known.customer.unique())
    ui = {u: i for i, u in enumerate(users)}; ii = {s: i for i, s in enumerate(model['items'])}
    full_history = {u: sorted(set(g.item)) for u, g in known.groupby('customer')}
    events = known.drop_duplicates(['customer', 'date', 'item'])
    events = events[events.item.isin(ii)].copy()
    rows = events.customer.map(ui).to_numpy(); cols = events.item.map(ii).to_numpy()
    ages = (pd.Timestamp(origin) - events.date).dt.days.to_numpy()
    shape = (len(users), len(ii))
    def csr(values, r=rows, c=cols):
        return sparse.csr_matrix((values, (r, c)), shape=shape, dtype=np.float64)
    frequency = csr(np.ones(len(events)))
    x = frequency.copy(); x.data[:] = 1
    recent = events.sort_values('date').drop_duplicates(['customer', 'item'], keep='last')
    recent_matrix = csr(1 / (1 + (pd.Timestamp(origin) - recent.date).dt.days.to_numpy()),
                        recent.customer.map(ui), recent.item.map(ii))
    # Interval readiness has a value only when two separate purchase days exist.
    repeated = events[events.duplicated(['customer', 'item'], keep=False)]
    gap_rows, gap_cols, gap_values = [], [], []
    for (user, item), group in repeated.groupby(['customer', 'item'], sort=False):
        days = np.sort((group.date - pd.Timestamp('2000-01-01')).dt.days.to_numpy())
        gap = float(np.median(np.diff(days)))
        age = (pd.Timestamp(origin) - group.date.max()).days
        gap_rows.append(ui[user]); gap_cols.append(ii[item])
        gap_values.append(float(np.exp(-abs(age - gap) / max(gap, 1))))
    matrices = {'frequency': frequency, 'recent': recent_matrix, 'decay90': csr(np.exp(-ages / 90)),
                'decay30': csr(np.exp(-ages / 30)), 'interval': csr(gap_values, gap_rows, gap_cols), 'itemcf': model['matrix']}
    factors = fit_als(x, recipe['als'], recipe['seed'], recipe['threads'])
    categories = known.sort_values('date').drop_duplicates('item', keep='last').set_index('item').category.fillna('unknown').to_dict()
    category_ids = sorted(set(categories.values())); ci = {c: i for i, c in enumerate(category_ids)}
    item_category = [ci[categories.get(item, 'unknown')] for item in model['items']]
    # A category affinity is a count of observed customer/item/day events.
    matrices['user_category'] = sparse.csr_matrix((np.ones(len(events)), (rows, events.item.map(lambda s: ci[categories[s]]))), shape=(len(users), len(ci)))
    recent_counts = events[events.date >= pd.Timestamp(origin) - pd.Timedelta(days=30)].groupby('item').customer.nunique()
    np.savez_compressed(out / 'arrays.npz', **factors, popularity=model['popularity'],
                        recent_popularity=np.array([recent_counts.get(s, 0) for s in model['items']]))
    for name, matrix in matrices.items():
        sparse.save_npz(out / f'{name}.npz', matrix)
    metadata = {'items': model['items'], 'users': users, 'histories': full_history, 'item_category': item_category,
                'origin': origin, 'training_last_date': str(train.date.max()), 'training_rows': len(train),
                'training_seconds': time.perf_counter() - started, 'recipe': recipe['als'],
                'feature_note': 'Distinct purchase days, recency, median historical interpurchase gap, train-only categories and binary interactions. No demographics.'}
    write_json(out / 'metadata.json', metadata)
    return load_recommendation(out)


def load_recommendation(out):
    out = Path(out)
    model = json.loads((out / 'metadata.json').read_text())
    with np.load(out / 'arrays.npz', allow_pickle=False) as arrays:
        model.update({k: arrays[k] for k in arrays.files})
    model.update({name: sparse.load_npz(out / f'{name}.npz') for name in [*PERSONAL, 'itemcf', 'user_category']})
    model['ui'] = {u: i for i, u in enumerate(model['users'])}
    model['ii'] = {s: i for i, s in enumerate(model['items'])}
    model['item_category'] = np.asarray(model['item_category'])
    return model


def normalized(score):
    positive = np.maximum(np.asarray(score, dtype=float), 0)
    return positive / max(positive.max(initial=0), 1e-12)


def signals(model, user):
    pop = model['popularity']
    if user not in model['ui']:
        return {'cold': True, 'popular': pop}
    row = model['ui'][user]
    result = {name: model[name].getrow(row).toarray().ravel() for name in PERSONAL}
    history = model['frequency'].getrow(row).indices
    result.update(cold=False, popular=pop, recent_popularity=model['recent_popularity'],
                  als=model['item_factors'] @ model['user_factors'][row],
                  itemcf=np.asarray(model['itemcf'][history].sum(axis=0)).ravel(),
                  category=model['user_category'].getrow(row).toarray().ravel()[model['item_category']] * np.sqrt(pop))
    return result


def model_score(values, params):
    if values['cold']:
        return values['popular']
    kind = params['kind']; weight = params.get('weight', 0)
    blends = {'interval_blend': ('interval', 'decay90'), 'als_decay': ('als', 'decay90'),
              'als_itemcf': ('als', 'itemcf'), 'als_category': ('category', 'als')}
    if kind in blends:
        first, second = blends[kind]
        return weight * normalized(values[first]) + (1 - weight) * normalized(values[second])
    return values[kind]


def task_rank(model, user, task, score, k=10):
    history = set(model['histories'].get(user, []))
    past = np.array([model['ii'][s] for s in history if s in model['ii']], dtype=int)
    mask = np.ones(len(model['items']), dtype=bool)
    if task == 'repurchase':
        mask[:] = False; mask[past] = True
    elif task == 'discovery':
        mask[past] = False
    else:
        raise ValueError('Unknown recommendation task')
    candidate = np.flatnonzero(mask)
    if not np.isfinite(score[candidate]).all():
        raise ValueError('Non-finite recommendation score')
    # Avoid sorting the entire catalog. Preserve lexicographic ID ties exactly.
    if len(candidate) > k:
        cutoff = np.partition(score[candidate], -k)[-k]
        above = candidate[score[candidate] > cutoff]
        equal = candidate[score[candidate] == cutoff][:k-len(above)]
        candidate = np.concatenate([above, equal])
    ranked = candidate[np.lexsort((candidate, -score[candidate]))][:k]
    return [model['items'][i] for i in ranked], int(mask.sum())


def recommendation_records(model, data, origin, end, specifications, out):
    targets = next_baskets(data, origin, end)
    records = {task: {name: [] for name in specs} for task, specs in specifications.items()}
    catalog = set(model['items'])
    for user, basket in sorted(targets.items()):
        values = signals(model, user)
        history = set(model['histories'].get(user, []))
        for task, specs in specifications.items():
            target = basket & history if task == 'repurchase' else basket - history
            for name, params in specs.items():
                ranked, candidates = task_rank(model, user, task, model_score(values, params))
                metrics = ranking_metrics(ranked, target)
                records[task][name].append({'customer': user, 'cohort': 'warm' if history else 'cold',
                    'target': sorted(target), 'ranked': ranked, 'ndcg': metrics['ndcg'],
                    'recall': metrics['recall'] if target else None, 'hit_rate': metrics['hit_rate'],
                    'precision': len(set(ranked) & target) / 10, 'target_count': len(target),
                    'oov_targets': len(target - catalog), 'candidate_count': candidates})
    for task, models in records.items():
        for name, rows in models.items():
            pd.DataFrame([{**r, 'target': json.dumps(r['target']), 'ranked': json.dumps(r['ranked'])} for r in rows]).to_csv(Path(out) / f'{task}-{name}.csv.gz', index=False)
    return records


def summarize_ranking(rows, catalog_count, task=None):
    def cohort(part):
        n = len(part); nonempty = [r for r in part if r['target_count']]
        if not n:
            return {'customers': 0, 'ndcg': None, 'recall': None}
        target_count = sum(r['target_count'] for r in part)
        return {'customers': n, 'nonempty_target_customers': len(nonempty),
                'ndcg': float(np.mean([r['ndcg'] for r in part])),
                'recall': float(np.mean([r['recall'] for r in nonempty])) if nonempty else None,
                'precision': float(np.mean([r['precision'] for r in part])),
                'hit_rate': float(np.mean([r['hit_rate'] for r in part])),
                'empty_target_share': 1-len(nonempty)/n,
                'candidate_shortfall_share': sum(r['candidate_count'] < 10 for r in part)/n,
                'oov_target_share': sum(r['oov_targets'] for r in part)/target_count if target_count else None,
                'catalog_coverage': len({s for r in part for s in r['ranked']})/catalog_count}
    result = {group: cohort([r for r in rows if r['cohort'] == group]) for group in ['warm', 'cold']}
    if task == 'repurchase':
        result['cold'] = {'customers': result['cold']['customers'], 'applicable': False}
    return result


def select_ranking(summaries, specs):
    key = lambda name: (-summaries[name]['warm']['ndcg'], specs[name]['complexity'], name)
    return min(summaries, key=key), min((name for name in summaries if specs[name]['baseline']), key=key)


def paired_ndcg(rows, baseline, seed=42, resamples=2000):
    chosen = {r['customer']: r['ndcg'] for r in rows if r['cohort'] == 'warm'}
    base = {r['customer']: r['ndcg'] for r in baseline if r['cohort'] == 'warm'}
    if not chosen or set(chosen) != set(base):
        raise ValueError('Paired customer cohort mismatch or empty')
    differences = np.array([chosen[u]-base[u] for u in sorted(chosen)])
    rng = np.random.default_rng(seed)
    samples = [float(differences[rng.integers(0, len(differences), len(differences))].mean()) for _ in range(resamples)]
    low, high = np.quantile(samples, [.025, .975])
    return {'difference': float(differences.mean()), 'low': float(low), 'high': float(high),
            'resamples': resamples, 'unit': 'customer', 'scope': 'conditional on one month'}


def weekly_features(past, origin, item_index, item_count):
    past = np.asarray(past, dtype=float)
    if len(past) < 28 or not np.isfinite(past).all():
        raise ValueError('At least 28 finite observed days required')
    weeks = past[-28:].reshape(4, 7).sum(axis=1)
    date = pd.Timestamp(origin)
    stats = [*weeks, weeks.mean(), np.median(weeks), past[-28:].std(), past[-28:].max()]
    extra = [(past[-28:] == 0).mean(), (past[-7:] == 0).mean(), weeks[-1]/max(weeks.mean(), 1),
             np.sin(2*np.pi*date.dayofweek/7), np.cos(2*np.pi*date.dayofweek/7),
             np.sin(2*np.pi*date.month/12), np.cos(2*np.pi*date.month/12)]
    return np.log1p(stats).tolist() + list(extra) + [float(i == item_index) for i in range(item_count)]


def weekly_training(values, dates, cutoff):
    stop = int(dates.get_loc(pd.Timestamp(cutoff)))
    x, y = [], []
    for i, series in enumerate(values):
        for start in range(28, stop-7+1):
            require_past_labels(dates[start]+pd.Timedelta(days=7), cutoff)
            x.append(weekly_features(series[:start], dates[start], i, len(values)))
            y.append(float(series[start:start+7].sum()))
    return np.asarray(x), np.asarray(y)


def forecast_specs(recipe):
    result = {f'lgbm_{objective}_{leaves}': {'objective': objective, 'num_leaves': leaves}
              for objective in recipe['forecast']['objectives'] for leaves in recipe['forecast']['num_leaves']}
    result.update({name: {'kind': name, 'num_leaves': 0} for name in recipe['forecast'].get('adaptive_candidates', [])})
    return result


def adaptive_weekly(history, kind):
    """Choose/blend last-week, mean and median from four already observed weeks.

    Every inner validation origin itself has at least 28 prior days. The current
    forecast target is never available to this selector, including during test.
    """
    history = np.asarray(history, dtype=float)
    if len(history) < 56:
        raise ValueError('Adaptive rule requires four observed inner validation weeks plus 28 days history')
    def baselines(past):
        weeks = past[-28:].reshape(4, 7).sum(axis=1)
        return np.array([weeks[-1], weeks.mean(), np.median(weeks)])
    errors = []
    for offset in [28, 21, 14, 7]:
        start = len(history)-offset
        errors.append(np.abs(baselines(history[:start])-history[start:start+7].sum()))
    mae = np.mean(errors, axis=0)
    current = baselines(history)
    if kind == 'history_router':
        return float(current[np.argmin(mae)])
    if kind == 'history_blend':
        weights = 1/(mae+1)  # Fixed one-unit regularizer, not chosen from future errors.
        return float(np.dot(current, weights)/weights.sum())
    raise ValueError('Unknown adaptive forecast rule')


def weekly_predictions(data, items, origins, recipe, specs, out):
    out = Path(out)
    dates = pd.date_range('2000-11-01', pd.Timestamp(origins[-1])+pd.Timedelta(days=6))
    values = data[data.item.isin(items)].groupby(['date', 'item']).quantity.sum().unstack(fill_value=0).reindex(index=dates, columns=items, fill_value=0).fillna(0).to_numpy(dtype=float).T
    rows, fallback, timing = [], [], {}
    for origin in origins:
        print(f'  Generate weekly predictions: {origin}', flush=True)
        start = int(dates.get_loc(pd.Timestamp(origin)))
        # Models receive only data observed before this origin.
        x, y = weekly_training(values, dates, origin)
        query = np.asarray([weekly_features(s[:start], origin, i, len(items)) for i, s in enumerate(values)])
        weeks = values[:, start-28:start].reshape(len(items), 4, 7).sum(axis=2)
        predictions = {'zero': np.zeros(len(items)), 'last_week': weeks[:, -1], 'four_week_mean': weeks.mean(axis=1), 'four_week_median': np.median(weeks, axis=1)}
        began = time.perf_counter()
        stat = statistical('autoets', values[:, :start].tolist(), 7, recipe['forecast']['statistical_timeout_seconds'])
        timing['autoets'] = timing.get('autoets', 0) + time.perf_counter()-began
        predictions['autoets'] = np.array([sum(s['prediction']) if s['prediction'] is not None else predictions['last_week'][i] for i, s in enumerate(stat)])
        for i, s in enumerate(stat):
            if s['failure']:
                fallback.append({'item': items[i], 'origin': origin, 'model': 'autoets', 'reason': s['failure'], 'fallback': 'last_week'})
        write_json(out/f'autoets-{origin}.json', {'histories': values[:, :start].tolist(), 'result': stat, 'horizon': 7})
        for name, params in specs.items():
            began = time.perf_counter()
            if params.get('kind') in ['history_router', 'history_blend']:
                predictions[name] = np.array([adaptive_weekly(s[:start], params['kind']) for s in values])
                timing[name] = timing.get(name, 0)+time.perf_counter()-began
                continue
            cfg = recipe['forecast']
            model = LGBMRegressor(**params, n_estimators=cfg['n_estimators'], learning_rate=cfg['learning_rate'],
                    min_child_samples=cfg['min_child_samples'], reg_lambda=cfg['reg_lambda'], random_state=recipe['seed'],
                    n_jobs=recipe['threads'], deterministic=True, force_col_wise=True, verbosity=-1).fit(x, y)
            predictions[name] = np.maximum(0, model.booster_.predict(query))
            timing[name] = timing.get(name, 0)+time.perf_counter()-began
            model.booster_.save_model(str(out/f'{name}-{origin}.txt'))
        for i, item in enumerate(items):
            row = {'origin': origin, 'item': item, 'actual': float(values[i, start:start+7].sum()), **{name: float(p[i]) for name, p in predictions.items()}}
            if not np.isfinite(list(row.values())[2:]).all():
                raise ValueError('Non-finite forecast')
            rows.append(row)
    frame = pd.DataFrame(rows)
    frame.to_csv(out/'weekly-predictions.csv.gz', index=False)
    # All four origins are completed before any metrics are calculated/reported.
    summary = {name: {'metrics': forecast_metrics(frame.actual, frame[name]),
                'windows': [{'origin': origin, **forecast_metrics(g.actual, g[name])} for origin, g in frame.groupby('origin')],
                'items': [{'item': item, **forecast_metrics(g.actual, g[name])} for item, g in frame.groupby('item')],
                'training_seconds': timing.get(name), 'fallbacks': sum(f['model'] == name for f in fallback)}
               for name in frame.columns if name not in ['origin', 'item', 'actual']}
    return frame, summary, fallback


def select_forecast(summary, specs):
    baseline = min(['last_week', 'four_week_mean', 'four_week_median', 'autoets'], key=lambda n: (summary[n]['metrics']['wape'], n))
    eligible = [n for n in specs if abs(summary[n]['metrics']['bias']) <= .20]
    selected = min(eligible, key=lambda n: (summary[n]['metrics']['wape'], specs[n]['num_leaves'], n)) if eligible else baseline
    return selected, baseline, bool(eligible)

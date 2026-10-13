"""Recompute saved scores and replay models; never opens sealed source labels."""
import argparse
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd
from lightgbm import Booster

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'services'))
from ml.evaluation_protocol import digest, read_json, verify_workspace, load_development
from ml.core import ranking_metrics
from ml.forecasting import forecast_metrics
from ml.tafeng import load_recommendation, signals, model_score, task_rank, summarize_ranking, weekly_features, adaptive_weekly


def verify(run):
    verify_workspace(ROOT)
    report = read_json(run/'report.json')
    for name, expected in read_json(run/'checksums.json').items():
        if digest(run/name) != expected:
            raise ValueError(f'Artifact changed: {name}')
    model = load_recommendation(run/'recommendation-model')
    recipe = read_json(run/'recipe.json')
    for task, summaries in report['recommendation'].items():
        for name, summary in summaries.items():
            frame = pd.read_csv(run/f'{task}-{name}.csv.gz', dtype={'customer': str})
            records = []
            for row in frame.to_dict('records'):
                row['target'] = json.loads(row['target']); row['ranked'] = json.loads(row['ranked'])
                metrics = ranking_metrics(row['ranked'], set(row['target']))
                assert np.isclose(metrics['ndcg'], row['ndcg'], rtol=1e-12)
                assert np.isclose(metrics['recall'], row['recall'], rtol=1e-12) if row['target'] else pd.isna(row['recall'])
                history = set(model['histories'].get(row['customer'], []))
                assert (set(row['ranked']) <= history) if task == 'repurchase' else not (set(row['ranked']) & history)
                records.append(row)
            recomputed = summarize_ranking(records, len(model['items']), task)
            for cohort in ['warm', 'cold']:
                for metric, value in summary[cohort].items():
                    assert value == recomputed[cohort][metric] if value is None else np.isclose(value, recomputed[cohort][metric], rtol=1e-12, atol=1e-14)
            # Deterministic dispersed sample for model-load ranking replay; all
            # rows above have their metrics and task exclusion rules recomputed.
            indices = np.unique(np.linspace(0, len(records)-1, min(32, len(records)), dtype=int))
            for index in indices:
                row = records[index]
                ranked, count = task_rank(model, row['customer'], task, model_score(signals(model, row['customer']), recipe['recommendation_models'][task][name]))
                assert ranked == row['ranked'] and count == row['candidate_count']
    weekly = pd.read_csv(run/'weekly-predictions.csv.gz', dtype={'item': str})
    for name, entry in report['weekly'].items():
        actual = forecast_metrics(weekly.actual, weekly[name])
        for key in actual:
            assert np.isclose(actual[key], entry['metrics'][key], rtol=1e-12)
    # Saved statistical input is the exact pre-origin history used by the run.
    for origin, part in weekly.groupby('origin', sort=True):
        ordered = part.set_index('item').loc[report['forecast_items']]
        stat = read_json(run/f'autoets-{origin}.json')
        histories = np.array(stat['histories'], dtype=float)
        query = np.array([weekly_features(s, origin, i, len(histories)) for i, s in enumerate(histories)])
        weeks = histories[:, -28:].reshape(len(histories), 4, 7).sum(axis=2)
        for name, values in {'zero': np.zeros(len(histories)), 'last_week': weeks[:, -1], 'four_week_mean': weeks.mean(axis=1), 'four_week_median': np.median(weeks, axis=1)}.items():
            np.testing.assert_allclose(values, ordered[name], rtol=1e-12)
        autoets = [sum(r['prediction']) if r['prediction'] is not None else weeks[i, -1] for i, r in enumerate(stat['result'])]
        np.testing.assert_allclose(autoets, ordered.autoets, rtol=1e-12)
        for name in report['weekly']:
            if name.startswith('history_'):
                np.testing.assert_allclose([adaptive_weekly(s, name) for s in histories], ordered[name], rtol=1e-12)
            if name.startswith('lgbm_'):
                pred = np.maximum(0, Booster(model_file=str(run/f'{name}-{origin}.txt')).predict(query))
                np.testing.assert_allclose(pred, ordered[name], rtol=1e-10)
    if report['phase'] != 'final':
        development = load_development(ROOT)
        for origin, part in weekly.groupby('origin'):
            source = development[(development.date >= origin) & (development.date < pd.Timestamp(origin)+pd.Timedelta(days=7))].groupby('item').quantity.sum()
            np.testing.assert_allclose([source.get(s, 0) for s in part.item], part.actual)
    print(f'Verified all saved ranking metrics/rules, sampled model reloads, all weekly model replays: {run.name}')
    print('No sealed-source test read. Final-run actuals are checked against immutable saved outputs, not re-opened for development.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('run_id'); args = parser.parse_args()
    run = (ROOT/'artifacts/tafeng-runs'/args.run_id).resolve()
    if run.parent != (ROOT/'artifacts/tafeng-runs').resolve():
        raise ValueError('Expected run ID')
    verify(run)

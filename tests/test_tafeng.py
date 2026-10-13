import os
for key in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS']:
    os.environ[key] = '2'
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'services'))
from ml.tafeng import (fit_recommendation, signals, model_score, task_rank, recommendation_records,
                      summarize_ranking, weekly_training, weekly_predictions, select_forecast, paired_ndcg, adaptive_weekly)
from ml.evaluation_protocol import read_json

ROOT = Path(__file__).resolve().parents[1]


class TaFengTests(unittest.TestCase):
    def test_task_ranking_keeps_full_history_and_lexicographic_ties(self):
        model = {'items': ['001', '002', '003', '004'], 'ii': {f'{i:03}': i-1 for i in range(1, 5)}, 'histories': {'u': ['001', '099']}}
        scores = np.ones(4)
        self.assertEqual(task_rank(model, 'u', 'repurchase', scores), (['001'], 1))
        self.assertEqual(task_rank(model, 'u', 'discovery', scores, 2), (['002', '003'], 3))
        self.assertEqual(task_rank(model, 'cold', 'repurchase', scores), ([], 0))
        with self.assertRaises(ValueError):
            task_rank(model, 'u', 'discovery', np.array([1, np.nan, 1, 1]))

    def test_fit_uses_purchase_days_not_duplicates_and_oov_stays_in_target(self):
        recipe = read_json(ROOT/'services/configs/tafeng-development-v1.json')
        recipe['als'] = {'factors': 3, 'iterations': 3, 'regularization': .1, 'confidence_increment': 1}
        rows = [('u', '001', '2000-11-01'), ('u', '001', '2000-11-01'), ('u', '001', '2000-11-08'),
                ('u', '099', '2000-12-01'), ('v', '001', '2000-11-01'), ('v', '002', '2000-11-02'),
                ('w', '002', '2000-11-03')]
        train = pd.DataFrame(rows, columns=['customer', 'item', 'date']).assign(category='a', quantity=1)
        train['date'] = pd.to_datetime(train.date)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            model = fit_recommendation(train, '2001-01-01', recipe, path/'model')
            self.assertNotIn('099', model['items'])
            self.assertIn('099', model['histories']['u'])
            self.assertEqual(signals(model, 'u')['frequency'][model['ii']['001']], 2)
            self.assertTrue(signals(model, 'new')['cold'])
            query = pd.DataFrame({'customer': ['u', 'u', 'v'], 'item': ['001', '099', '003'],
                                  'date': pd.to_datetime(['2001-01-02']*3), 'category': ['a']*3, 'quantity': [1]*3})
            specs = {'repurchase': {'frequency': {'kind': 'frequency'}}, 'discovery': {'popular': {'kind': 'popular'}}}
            result = recommendation_records(model, query, '2001-01-01', '2001-02-01', specs, path)
            u = result['repurchase']['frequency'][0]
            self.assertEqual(u['target'], ['001', '099'])
            self.assertEqual(u['recall'], .5)
            self.assertEqual(u['oov_targets'], 1)
            summary = summarize_ranking(result['repurchase']['frequency'], len(model['items']))['warm']
            self.assertEqual(summary['empty_target_share'], .5)
            self.assertEqual(summary['ndcg'], u['ndcg']/2)
            with self.assertRaises(ValueError):
                fit_recommendation(train, '2000-12-01', recipe, path/'bad')

    def test_training_windows_never_include_future_label_or_features(self):
        dates = pd.date_range('2000-11-01', periods=110)
        values = np.arange(110, dtype=float)[None, :]
        cutoff = dates[61]
        x, y = weekly_training(values, dates, cutoff)
        self.assertEqual(len(y), 61-7-28+1)
        self.assertEqual(y[-1], sum(range(54, 61)))
        values[:, 61:] = 999999
        xx, yy = weekly_training(values, dates, cutoff)
        np.testing.assert_array_equal(x, xx); np.testing.assert_array_equal(y, yy)

    def test_weekly_prediction_ignores_future_changes_and_saves_reloadable_model(self):
        recipe = read_json(ROOT/'services/configs/tafeng-development-v1.json')
        recipe['forecast']['n_estimators'] = 5
        dates = pd.date_range('2000-11-01', periods=68)
        data = pd.DataFrame({'date': dates, 'item': '001', 'quantity': np.arange(68) % 9 + 1})
        specs = {'lgbm_small': {'objective': 'regression', 'num_leaves': 7}}
        def stat(name, histories, horizon, timeout):
            return [{'prediction': [float(s[-1])]*horizon, 'failure': None} for s in histories]
        with tempfile.TemporaryDirectory() as temp, patch('ml.tafeng.statistical', stat):
            a, b = Path(temp)/'a', Path(temp)/'b'; a.mkdir(); b.mkdir()
            first, _, _ = weekly_predictions(data, ['001'], ['2001-01-01'], recipe, specs, a)
            data.loc[data.date >= '2001-01-01', 'quantity'] = 999999
            second, _, _ = weekly_predictions(data, ['001'], ['2001-01-01'], recipe, specs, b)
            for column in first.columns[3:]:
                np.testing.assert_array_equal(first[column], second[column])
            self.assertNotEqual(first.actual.iloc[0], second.actual.iloc[0])
            self.assertTrue((a/'lgbm_small-2001-01-01.txt').exists())

    def test_selection_and_paired_cohort_are_explicit(self):
        summary = {name: {'metrics': {'wape': .5+i*.01, 'bias': 0}} for i, name in enumerate(['last_week', 'four_week_mean', 'four_week_median', 'autoets'])}
        summary['candidate'] = {'metrics': {'wape': .1, 'bias': -.6}}
        self.assertEqual(select_forecast(summary, {'candidate': {'num_leaves': 7}}), ('last_week', 'last_week', False))
        rows = [{'customer': 'u', 'cohort': 'warm', 'ndcg': .2}, {'customer': 'v', 'cohort': 'warm', 'ndcg': .4}]
        interval = paired_ndcg(rows, rows, resamples=10)
        self.assertEqual(interval['low'], 0)
        with self.assertRaises(ValueError):
            paired_ndcg(rows, rows[:1], resamples=10)

    def test_adaptive_rules_use_completed_inner_weeks(self):
        history = np.repeat(np.array([1, 2, 3, 4, 5, 6, 7, 8], dtype=float), 7)
        # A linear trend makes last week the least-wrong of these three rules.
        self.assertEqual(adaptive_weekly(history, 'history_router'), 56)
        self.assertGreater(adaptive_weekly(history, 'history_blend'), 45.5)
        self.assertLess(adaptive_weekly(history, 'history_blend'), 56)
        with self.assertRaises(ValueError):
            adaptive_weekly(history[:55], 'history_router')


if __name__ == '__main__':
    unittest.main()

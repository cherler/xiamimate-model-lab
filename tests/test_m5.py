import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.competitions.m5_metrics import WRMSSE, scale_after_first_sale
from services.competitions.m5_features import make_features, baselines
from services.competitions.m5_data import revenue_at


class M5MetricTests(unittest.TestCase):
    def test_trim_leading_zero_without_dropping_intermittent_zeros(self):
        np.testing.assert_allclose(scale_after_first_sale([[0, 0, 2, 0, 4]]), [10])

    def test_hand_computed_hierarchy_and_revenue_weights(self):
        meta = pd.DataFrame({'state_id': ['CA', 'CA'], 'store_id': ['CA_1', 'CA_1'],
                             'cat_id': ['A', 'A'], 'dept_id': ['A1', 'A1'], 'item_id': ['a', 'b']})
        history = np.array([[1, 2, 3, 4], [2, 4, 6, 8]])
        metric = WRMSSE(meta, history, np.array([1, 3]))
        actual = np.ones((2, 28)) * 10
        predicted = actual - np.array([[1], [4]])
        # Nine aggregated levels: 5/3. Three item levels: .25*1 + .75*2.
        report = metric.score(actual, predicted)
        self.assertAlmostEqual(report['scope_wrmsse'], (9 * (5 / 3) + 3 * 1.75) / 12)
        self.assertAlmostEqual(report['wape'], .25)
        self.assertEqual(metric.score(actual, actual)['scope_wrmsse'], 0)

    def test_rejects_invalid_predictions_and_undefined_scale(self):
        meta = pd.DataFrame({x: ['a'] for x in ['state_id','store_id','cat_id','dept_id','item_id']})
        with self.assertRaises(ValueError):
            WRMSSE(meta, [[1, 1, 1]], [1])
        metric = WRMSSE(meta, [[1, 2, 3]], [1])
        with self.assertRaises(ValueError):
            metric.score(np.ones((1, 28)), np.full((1, 28), np.nan))
        with self.assertRaises(ValueError):
            metric.score(np.ones((1, 7)), np.ones((1, 7)))


class M5FeatureTests(unittest.TestCase):
    def test_28_day_forecast_never_reads_unobserved_sales_or_price_statistics(self):
        origin = 300
        meta = pd.DataFrame({'item_id': ['a'], 'dept_id': ['d'], 'cat_id': ['c'], 'state_id': ['CA']})
        cal = pd.DataFrame({'date': pd.date_range('2015-01-01', periods=328),
                            'wday': np.arange(328) % 7, 'month': 1, 'year': 2015, 'snap_CA': 0,
                            **{k: ['none'] * 328 for k in ['event_name_1','event_name_2','event_type_1','event_type_2']}})
        history = np.arange(1, 301, dtype='float32')[None, :]
        prices = np.ones((1, 328), dtype='float32')
        x, y, train, forecast, _ = make_features(meta, history, cal, prices, origin, 70)
        rows = x.loc[forecast]
        self.assertEqual(len(rows), 28)
        self.assertEqual(rows.iloc[0].lag_28, 273)
        self.assertEqual(rows.iloc[-1].lag_28, 300)
        self.assertEqual(rows.iloc[0].rolling_mean_7, np.mean(np.arange(267, 274)))
        self.assertTrue(np.isnan(y[forecast]).all())
        self.assertEqual(y[train][-1], 300)
        prices[:, 300:] = 999
        changed, *_ = make_features(meta, history, cal, prices, origin, 70)
        np.testing.assert_array_equal(x.price_history_mean, changed.price_history_mean)
        with self.assertRaises(ValueError):
            make_features(meta, np.pad(history, ((0,0),(0,28))), cal, prices, origin, 70)

    def test_revenue_uses_last_28_days_and_requires_prices_for_sales(self):
        history = np.ones((1, 60))
        prices = np.ones((1, 60)) * 2
        self.assertEqual(revenue_at(history, prices, 56)[0], 56)
        prices[:, 56:] = 10000
        self.assertEqual(revenue_at(history, prices, 56)[0], 56)
        prices[0, 55] = np.nan
        with self.assertRaises(ValueError):
            revenue_at(history, prices, 56)

    def test_weekday_baselines_align_all_four_future_weeks(self):
        history = np.tile(np.arange(1, 8), (2, 8))
        for prediction in baselines(history).values():
            np.testing.assert_array_equal(prediction, np.tile(np.arange(1, 8), (2, 4)))


if __name__ == '__main__':
    unittest.main()

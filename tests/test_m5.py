import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.competitions.m5_metrics import WRMSSE, scale_after_first_sale


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


if __name__ == '__main__':
    unittest.main()

import os
for key in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS']:
    os.environ[key] = '2'
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services'))
import numpy as np
import pandas as pd
from scipy import sparse
from ml.core import build_itemcf
from ml.recommenders import fit_ease, fit_als, interaction_matrix, rank_items
from ml.forecasting_v2 import training_arrays, statistical
from server import Artifacts
from test_ml import fixture


class RoundTwoTests(unittest.TestCase):
    def test_ease_matches_independent_constrained_ridge_solutions(self):
        x = np.array([[1,1,0], [1,0,1], [0,1,1], [1,1,1]], dtype=float)
        weights = fit_ease(sparse.csr_matrix(x), 2)
        np.testing.assert_array_equal(np.diag(weights), 0)
        for target in range(3):
            others = [i for i in range(3) if i != target]
            expected = np.linalg.solve(x[:,others].T @ x[:,others] + 2 * np.eye(2), x[:,others].T @ x[:,target])
            np.testing.assert_allclose(weights[others,target], expected, atol=1e-12)
        with self.assertRaises(ValueError): fit_ease(sparse.csr_matrix(x), 0)

    def trained(self):
        model = build_itemcf(fixture())
        users, x = interaction_matrix(model); model['users'] = users
        model['ease_weights'] = fit_ease(x, 10)
        model.update(fit_als(x, dict(factors=3, regularization=.1, confidence_increment=1, iterations=8), threads=1))
        model['as_of'] = '2011-02-01'; model['schema_version'] = 2
        return model, x

    def test_als_reproducibility_and_both_models_rules(self):
        model, x = self.trained()
        repeated = fit_als(x, dict(factors=3, regularization=.1, confidence_increment=1, iterations=8), threads=1)
        np.testing.assert_allclose(repeated['user_factors'], model['user_factors'], atol=1e-6)
        for name in ['als', 'ease']:
            popular = rank_items(model, 'new', 'popular')[0]
            ranked, _, fallback = rank_items(model, 'new', name)
            self.assertEqual(ranked, popular); self.assertTrue(fallback)
            ranked, scores, fallback = rank_items(model, '1', name, exclude=True)
            self.assertFalse(fallback)
            self.assertTrue(all(model['items'][i] not in model['histories']['1'] for i in ranked))
            self.assertTrue(all(np.isfinite(scores[i]) for i in ranked))

    def test_new_models_api_explanations_are_model_specific(self):
        store = Artifacts(); store.model, _ = self.trained(); store.run_id = 'fixture'; store.profiles = {}
        for name, reason in [('als', 'latent_factors'), ('ease', 'linear_contributions')]:
            result = store.recommend({'customer_id': '1', 'strategy': name})
            self.assertEqual(result['items'][0]['reason']['type'], reason)
            self.assertFalse(result['fallback'])

    def test_artifact_loading_is_verified_and_atomic(self):
        model, _ = self.trained()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); run_id = 'retail-20261011T000000Z'
            run = root / 'artifacts/runs' / run_id; run.mkdir(parents=True)
            skip = {'matrix','popularity','ease_weights','user_factors','item_factors'}
            (run / 'model.json').write_text(json.dumps({k:v for k,v in model.items() if k not in skip}))
            for name, value in [('report.json', {'schema_version':2}), ('profiles.json',{}), ('forecast-series.json',[])]:
                (run / name).write_text(json.dumps(value))
            sparse.save_npz(run / 'itemcf.npz', model['matrix'])
            np.save(run / 'popularity.npy', model['popularity'])
            np.save(run / 'ease.npy', model['ease_weights'])
            np.savez(run / 'als.npz', user_factors=model['user_factors'], item_factors=model['item_factors'])
            (run / 'checksums.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in run.iterdir()}))
            pointer = root / 'artifacts/latest.json'; pointer.write_text(json.dumps({'run_id':run_id}))
            store = Artifacts(root).load()
            for strategy in ['als','ease']:
                self.assertEqual(rank_items(model,'1',strategy)[0],rank_items(store.model,'1',strategy)[0])
            pointer.write_text(json.dumps({'run_id':'retail-20261011T000001Z'}))
            with self.assertRaises(FileNotFoundError): store.load()
            self.assertEqual(store.run_id,run_id)
            pointer.write_text(json.dumps({'run_id':run_id}))
            with (run / 'ease.npy').open('ab') as stream: stream.write(b'tampered')
            with self.assertRaisesRegex(ValueError,'integrity'): Artifacts(root).load()

    def test_forecast_raw_labels_and_features_ignore_future(self):
        dates = pd.date_range('2011-01-01', periods=150)
        values = np.arange(300, dtype=float).reshape(2,150)
        x, y = training_arrays(values, dates, 110)
        values[:,110:] = 999999
        x2, y2 = training_arrays(values, dates, 110)
        np.testing.assert_array_equal(x,x2); np.testing.assert_array_equal(y,y2)
        self.assertGreater(y.max(), 100)  # LightGBM raw quantities, not log1p labels.

    def test_statistical_worker_timeout_explicit_failure(self):
        rows = statistical('autoarima', [[1.] * 100], 28, .0001)
        self.assertIsNone(rows[0]['prediction'])
        self.assertIn('exceeded', rows[0]['failure'])


if __name__ == '__main__': unittest.main()

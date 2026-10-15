"""Recheck explanations against frozen model inference, never refit or open partitions."""
import hashlib
import json
import unittest
import joblib
import numpy as np
from services.classification.explain import ROOT, RUN, decompose
from services.classification.run import predict

class ClassificationExplanationTest(unittest.TestCase):
    def test_published_rows_reproduce_scores_and_exported_attributions(self):
        web=ROOT/'apps/web'
        manifest=json.loads((web/'classification-results/manifest.json').read_text())
        parent=json.loads((web/'classification-results'/manifest['path']).read_text())
        em=json.loads((web/'classification-explanations/manifest.json').read_text())
        explanations=json.loads((web/'classification-explanations'/em['path']).read_text())
        path=ROOT/'artifacts/classification-runs'/RUN/'models.joblib'
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),parent['report']['model_sha256'])
        bundle=joblib.load(path)
        for split in ['validation','test']:
            rows=parent['rows'][split][::100]
            x=np.array([r['features'] for r in rows]);parts=decompose(bundle,x)
            raw,calibrated=predict(bundle,{'x':x})
            for model,(base,contributions,margin) in parts.items():
                np.testing.assert_allclose(base+contributions.sum(axis=1),margin,atol=1e-10)
                np.testing.assert_allclose(1/(1+np.exp(-margin)),raw[model],atol=1e-10)
                np.testing.assert_allclose(calibrated[model],[r['scores'][model] for r in rows],atol=1e-10)
                for i,row in enumerate(rows):
                    saved=explanations['rows'][split][row['id']][model]
                    np.testing.assert_allclose(contributions[i],saved['contributions'],atol=1e-10)
                    self.assertAlmostEqual(base[i],saved['base'],places=10)

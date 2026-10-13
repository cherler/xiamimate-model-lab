"""Validate display export guardrails with disposable files, never reopen test data."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('showcase_export',ROOT/'scripts/export-showcase.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ShowcaseExportTests(unittest.TestCase):
    def test_artifact_tamper_and_missing_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            run=Path(temp); payload=run/'report.json';payload.write_text('{"score":1}')
            (run/'checksums.json').write_text(json.dumps({'report.json':module.sha(payload)}))
            module.verify_files(run)
            payload.write_text('{"score":2}')
            with self.assertRaises(ValueError):module.verify_files(run)
            payload.unlink()
            with self.assertRaises(FileNotFoundError):module.verify_files(run)

    def test_sample_is_input_order_invariant_and_never_uses_outcomes(self):
        ids=[f'{i:08}' for i in range(100)]
        self.assertEqual(module.stable_sample(ids,24),module.stable_sample(list(reversed(ids)),24))
        self.assertEqual(len(set(module.stable_sample(ids,24))),24)

    def test_metric_gate_keeps_null_distinct_from_zero(self):
        module.equal({'recall':None,'ndcg':0.1},{'recall':None,'ndcg':0.1})
        with self.assertRaises(ValueError):module.equal({'recall':0},{'recall':None})
        with self.assertRaises(ValueError):module.equal({'ndcg':0.2},{'ndcg':0.1})
        with self.assertRaises(ValueError):module.equal({'ndcg':float('nan')},{'ndcg':0.1})

if __name__=='__main__':unittest.main()

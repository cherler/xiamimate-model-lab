import sys
from pathlib import Path
import tempfile
import unittest
import optuna
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'hpo'))
from engine import StudyRunner

class HPOTests(unittest.TestCase):
    def test_resume_binding_and_freeze(self):
        with tempfile.TemporaryDirectory() as d:
            spec={'model':'test','objective':'validation-only','source_sha':'a'}
            r=StudyRunner(d,spec,'minimize');r.optimize(lambda t:(t.suggest_float('x',0,1)-.3)**2,2,10)
            r=StudyRunner(d,spec,'minimize');r.optimize(lambda t:(t.suggest_float('x',0,1)-.3)**2,4,10)
            self.assertEqual(len(r.study.trials),4);f=r.freeze();self.assertEqual(f['trial'],r.study.best_trial.number)
            with self.assertRaises(ValueError):r.optimize(lambda t:0.,5,10)
            with self.assertRaises(ValueError):StudyRunner(d,{**spec,'source_sha':'changed'},'minimize')
    def test_failed_and_pruned_trials_remain_visible(self):
        with tempfile.TemporaryDirectory() as d:
            r=StudyRunner(d,{'model':'test','objective':'score'},'maximize')
            def objective(t):
                if t.number==0:raise ValueError('invalid trial')
                if t.number==1:raise optuna.TrialPruned('budget')
                return .5
            r.optimize(objective,3,10);self.assertEqual([t['state'] for t in r.export()],['FAIL','PRUNED','COMPLETE']);self.assertEqual(r.freeze()['trial'],2)

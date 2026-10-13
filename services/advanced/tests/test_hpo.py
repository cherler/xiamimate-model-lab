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

class BoundaryTests(unittest.TestCase):
    def test_rejects_training_and_validation_label_overlap(self):
        import json,copy
        from protocol import validate_boundaries
        root=Path(__file__).resolve().parents[1]
        config=json.loads((root/'hpo/config.json').read_text());base=json.loads((root/'config.json').read_text());validate_boundaries(config,base)
        bad=copy.deepcopy(config);bad['recommendation']['training_origins'].append('2011-08-01')
        with self.assertRaises(ValueError):validate_boundaries(bad,base)
        bad=copy.deepcopy(config);bad['recommendation'].update(validation_origin='2011-09-01',label_end='2011-10-01')
        with self.assertRaises(ValueError):validate_boundaries(bad,base)
    def test_ranking_objective_keeps_unretrieved_targets(self):
        from recommendation import full_ndcg
        import numpy as np
        query={'ids':np.array([0,1]),'labels':np.array([1,0]),'target':['a','missing1','missing2']}
        self.assertAlmostEqual(full_ndcg(np.array([1.,0.]),[query]),1/(1+1/np.log2(3)+1/np.log2(4)))
    def test_forecast_lags_never_read_the_seven_day_target(self):
        from forecasting import add_lags,LAGS
        from forecast import prediction_frame
        import pandas as pd
        import numpy as np
        frame=pd.DataFrame({'date':pd.date_range('2011-01-01',periods=90),'item':'a','time_idx':range(90),'quantity':np.arange(90,dtype=float)})
        start=frame.date.iloc[75];cfg={'encoder_days':56,'horizon':7};original=prediction_frame(add_lags(frame),start,cfg)
        frame.loc[frame.date>=start,'quantity']=999999.
        poisoned=prediction_frame(add_lags(frame),start,cfg)
        np.testing.assert_array_equal(original[LAGS],poisoned[LAGS]);np.testing.assert_array_equal(original.quantity,poisoned.quantity)

class TrialRecordTests(unittest.TestCase):
    def test_nonfinite_intermediate_is_not_published_as_a_score(self):
        with tempfile.TemporaryDirectory() as d:
            r=StudyRunner(d,{'model':'test','objective':'score'},'minimize')
            def objective(t):
                t.report(float('nan'),0)
                return .5
            r.optimize(objective,1,10)
            self.assertEqual(r.export()[0]['intermediate'],{})

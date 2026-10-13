import sys
from pathlib import Path
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from automl.policy import select
from automl.features import forecast_features, forecast_columns, REC_GROUPS

class SelectionTests(unittest.TestCase):
    def candidate(self,id,value,cost,state='COMPLETE',split='validation'):
        return dict(id=id,value=value,cost_seconds=cost,state=state,split=split)
    def test_direction_tolerance_and_pareto(self):
        rows=[self.candidate('accurate',.8,10),self.candidate('cheap',.806,1),self.candidate('bad',.9,20)]
        s=select(rows,'minimize');self.assertEqual(s['accuracy'],'accurate');self.assertEqual(s['efficient'],'cheap');self.assertEqual(s['pareto'],['accurate','cheap'])
        self.assertEqual(select(rows,'maximize')['accuracy'],'bad')
        self.assertEqual(select(rows,'minimize',0)['efficient'],'accurate')
    def test_failure_replay_and_nonfinite_rejected(self):
        rows=[self.candidate('ok',.3,3),self.candidate('failed',1,0,'FAIL')]
        self.assertEqual(select(rows,'maximize')['accuracy'],'ok')
        for candidate in [self.candidate('leak',.99,0,split='replay'),self.candidate('nan',float('nan'),1)]:
            with self.assertRaises(ValueError):select([candidate],'maximize')
    def test_cost_never_overrides_tolerance_and_ties_stable(self):
        rows=[self.candidate('a',.4,10),self.candidate('b',.39,0)]
        self.assertEqual(select(rows,'maximize')['efficient'],'a')
        rows.append(self.candidate('c',.4,10))
        self.assertEqual(select(rows[::-1],'maximize')['accuracy'],'a')

class FeatureTests(unittest.TestCase):
    def test_feature_groups_have_expected_semantics(self):
        from ranking import FEATURES, BEHAVIOR, ATTRIBUTES, CROSSES
        self.assertEqual([FEATURES[i] for i in REC_GROUPS['cross']],BEHAVIOR+ATTRIBUTES+CROSSES)
        self.assertNotIn('log_item_price',[FEATURES[i] for i in REC_GROUPS['text']])
        self.assertEqual(len(forecast_columns('history',24)),37)
        self.assertEqual(len(forecast_columns('calendar',24)),41)
    def test_forecast_preparation_ignores_future_targets_in_inputs(self):
        from automl.prepare import forecast_inputs
        dates=pd.date_range('2011-01-01',periods=100)
        frame=pd.DataFrame(dict(date=dates,item='A',time_idx=np.arange(100),quantity=np.arange(100.),log_price=2.))
        cfg={'train_start':'2011-01-01','train_end':'2011-03-01'}
        before,rows,_=forecast_inputs(frame,cfg,['2011-03-02'],True)
        frame.loc[frame.date>=pd.Timestamp('2011-03-02'),'quantity']=999999.
        after,changed,_=forecast_inputs(frame,cfg,['2011-03-02'],True)
        for k in ['x','train_x','train_y']:np.testing.assert_array_equal(before[k],after[k])
        self.assertNotEqual(rows[0]['actual'],changed[0]['actual'])

    def test_feature_parity_and_future_poison(self):
        from forecast import tree_features
        history=np.arange(70.)
        for h in range(1,8):
            date=pd.Timestamp('2011-08-01')+pd.Timedelta(days=h-1)
            a=forecast_features(history,h,date,2.,1,3)
            np.testing.assert_allclose(a,tree_features(history,h,date,2.,1,3))
        future=np.r_[history,np.full(7,999999.)]
        np.testing.assert_array_equal(forecast_features(future[:70],1,pd.Timestamp('2011-08-01'),2.,1,3),forecast_features(history,1,pd.Timestamp('2011-08-01'),2.,1,3))
if __name__=='__main__':unittest.main()

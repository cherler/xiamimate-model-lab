import unittest
import numpy as np
import pandas as pd
from services.anomaly_study.core import replay,calibrate,evaluate,DAY
from services.monitoring.anomaly import causal_features

def rows(values,step=3600000):return [{'t':i*step,'scores':None if v is None else {'static':v}} for i,v in enumerate(values)]
class AnomalyCrossTests(unittest.TestCase):
    def test_causal_capacity_boundary(self):
        r=rows([2]*49);alerts,states=replay(r,'static',1,1)
        self.assertEqual(alerts,[0,24,48]);self.assertEqual(states.count('capacity'),46)
    def test_cooldown_and_suppression_do_not_extend(self):
        self.assertEqual(replay(rows([2]*6,1800000),'static',1,None)[0],[0,2,4])
        self.assertEqual(replay(rows([1,2,None,2]),'static',1,2)[0],[1,3])
    def test_calibration_minimum_feasible(self):
        r=rows([1,1,2,2,9,9]);c=calibrate(r,'static',1,1,[0,.5,1])
        self.assertEqual(c['threshold'],9);self.assertEqual(c['alerts'],0)
        c=calibrate(r,'static',2,1,[0,.5,1]);self.assertEqual(c['threshold'],2)
    def test_miss_outside_duplicate_and_gap(self):
        r=rows([2,2,None,0,2]);ws=[{'start':0,'end':3600000},{'start':2*3600000,'end':2*3600000},{'start':3*3600000,'end':3*3600000}]
        x=evaluate(r,ws,'static',1,1)
        self.assertEqual((x['detected'],x['missed'],x['duplicates'],x['outside_alerts']),(1,2,1,1))
        self.assertEqual([e['miss_reason'] for e in x['events']],[None,'unscorable','no_signal'])
    def test_budget_miss_and_empty_events(self):
        r=rows([2,0,2]);x=evaluate(r,[{'start':7200000,'end':7200000}],'static',1,1,1)
        self.assertEqual(x['events'][0]['miss_reason'],'capacity');self.assertEqual(x['outside_alerts'],1)
        self.assertIsNone(evaluate(r,[],'static',1,1,1)['recall'])
    def test_capacity_can_change_later_cooldown(self):
        # Cap suppresses a late day-one alert, allowing a day-two event missed by uncapped cooldown.
        r=[{'t':t*60000,'scores':{'static':2}} for t in [0,1430,1440]]
        self.assertEqual(replay(r,'static',1,None)[0],[0,1]);self.assertEqual(replay(r,'static',1,1)[0],[0,2])
    def test_reject_invalid(self):
        for threshold,budget in [(float('nan'),1),(1,0),(1,1.5)]:
            with self.assertRaises(ValueError):replay(rows([2]),'static',threshold,budget)
        with self.assertRaises(ValueError):replay([{'t':0,'scores':None}]*2,'static',1)
    def test_future_values_do_not_change_past_features(self):
        times=pd.date_range('2020-01-01',periods=60,freq='h');v=np.arange(60,dtype=float);a=causal_features(times,v,.1);v[45:]=9999;b=causal_features(times,v,.1)
        for x,y in zip(a,b):np.testing.assert_equal(x[:45],y[:45])
if __name__=='__main__':unittest.main()

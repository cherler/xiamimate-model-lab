import sys
from pathlib import Path
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services/advanced'))
from ranking import build_snapshot,candidates_features,make_queries,FEATURES

class AdvancedRankingTests(unittest.TestCase):
    def data(self):
        return pd.DataFrame([
          ['2011-01-01','u1','a','RED MUG',2.,'1'],['2011-01-02','u1','b','BLUE BAG',4.,'2'],
          ['2011-01-03','u2','a','RED MUG',2.,'3'],['2011-01-03','u2','b','BLUE BAG',4.,'3'],
          ['2011-02-02','u1','a','FUTURE NAME',200.,'4'],['2011-02-02','u1','unseen','FUTURE ITEM',300.,'4']
        ],columns=['date','customer','item','name','price','invoice']).assign(date=lambda x:pd.to_datetime(x.date))
    cfg={'history_start':'2011-01-01','max_items':10,'sample_customers':10,'candidate_sources':{'decay':1,'itemcf':1,'popular':1}}
    def test_future_attributes_and_targets_cannot_change_candidates_or_features(self):
        data=self.data();s=build_snapshot(data,'2011-02-01',self.cfg);ids,x=candidates_features(s,'u1',self.cfg)
        altered=data.copy();altered.loc[altered.date>=pd.Timestamp('2011-02-01'),['name','price']]=['SECRET NEW LABEL',9999]
        s2=build_snapshot(altered,'2011-02-01',self.cfg);ids2,x2=candidates_features(s2,'u1',self.cfg)
        np.testing.assert_array_equal(ids,ids2);np.testing.assert_array_equal(x,x2)
        self.assertEqual(x.shape[1],len(FEATURES));self.assertNotIn('unseen',s['items'])
        q,c=make_queries(data,s,self.cfg);self.assertEqual(c['returning'],1);self.assertEqual(c['unobserved'],1)
        self.assertIn('unseen',q[0]['target']);self.assertLess(q[0]['labels'].sum(),len(q[0]['target']))
        self.assertTrue(all(float(v)<10 for v in s['prices']))
    def test_catalog_and_features_are_deterministic_under_future_append(self):
        d=self.data();s=build_snapshot(d,'2011-02-01',self.cfg)
        self.assertEqual(s['names'],['RED MUG','BLUE BAG'])
        self.assertEqual(s['x'].shape,(2,2));self.assertEqual(s['x'].nnz,4)
        self.assertTrue(s['max_input_date']<'2011-02-01')

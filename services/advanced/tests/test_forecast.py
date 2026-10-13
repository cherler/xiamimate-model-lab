import sys
from pathlib import Path
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from forecast import prediction_frame,prepare_series,quantile_metrics,tree_features

class ForecastTests(unittest.TestCase):
    def test_future_attributes_cannot_change_static_features_or_selection(self):
        rows=[]
        for day in pd.date_range('2011-01-01','2011-04-10'):
            for item in ['a','b']:rows.append({'date':day,'item':item,'quantity':2.,'price':3.,'name':'PAST NAME'})
        data=pd.DataFrame(rows);cfg={'train_start':'2011-01-01','train_end':'2011-03-01','evaluation_origins':['2011-04-01'],'horizon':7,'items':2,'minimum_active_days':10,'encoder_days':56}
        frame,names=prepare_series(data,cfg);data.loc[data.date>=pd.Timestamp('2011-03-01'),['name','price']]=['FUTURE NAME',9999]
        changed,names2=prepare_series(data,cfg)
        np.testing.assert_array_equal(frame.log_price,changed.log_price);self.assertEqual(names,names2)
        query=prediction_frame(frame,'2011-04-01',cfg)
        self.assertTrue((query[query.date>=pd.Timestamp('2011-04-01')].quantity==0).all())
        self.assertEqual(len(query),2*(56+7));self.assertEqual(query.date.max(),pd.Timestamp('2011-04-07'))
    def test_quantile_scores_and_tree_inputs(self):
        result=quantile_metrics([0,10],[[0,1,2],[8,9,10]],[.1,.5,.9])
        self.assertEqual(result['coverage'],1.);self.assertEqual(result['mean_width'],2.)
        self.assertAlmostEqual(result['pinball']['0.5'],.5)
        features=tree_features(np.arange(56),1,pd.Timestamp('2011-04-01'),1.,0,2)
        self.assertTrue(np.isfinite(features).all());self.assertEqual(features[-2:],[1.,0.])

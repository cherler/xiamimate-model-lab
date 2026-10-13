"""Small invented fixtures test temporal boundaries and retrieval equivalence."""
import unittest
import numpy as np
import pandas as pd
from services.competitions.coverage_forecast import empirical_quantile,interval_metrics,make_bounds,past_only,point_metrics
from services.competitions.coverage_recommend import RetrievalEngine
from services.competitions.dressipi import SessionBaselines
from services.competitions.dressipi_run import candidate_features


class CoverageTests(unittest.TestCase):
    def test_quantile_uses_order_statistic_and_rejects_insufficient_calibration(self):
        self.assertEqual(empirical_quantile(np.arange(10),.8),8)
        with self.assertRaisesRegex(ValueError,'insufficient'):empirical_quantile([1],.9)

    def test_interval_score_penalizes_misses_and_rejects_crossing(self):
        m=interval_metrics([0,2,5],[1,1,1],[3,3,3],.8)
        self.assertAlmostEqual(m['coverage'],1/3)
        self.assertEqual(m['width'],2)
        self.assertAlmostEqual(m['interval_score'],12)
        self.assertAlmostEqual(m['below'],1/3);self.assertAlmostEqual(m['above'],1/3)
        with self.assertRaisesRegex(ValueError,'invalid'):interval_metrics([1],[2],[1],.8)
        self.assertIsNone(point_metrics([0,0],[1,2])['wape'])

    def test_future_labels_do_not_affect_bounds_and_overlap_is_rejected(self):
        p=np.ones((2,28));previous=[{'origin':100,'actual':p*3,'predictions':{'m':p},'scale':np.ones(2)}]
        current={'origin':128,'actual':p*999,'predictions':{'m':p*2},'scale':np.ones(2)}
        lo,hi,q=make_bounds(previous,current,'m',.9,np.array(['cat','cat']))
        self.assertTrue(np.array_equal(lo,np.zeros_like(p)));self.assertTrue(np.array_equal(hi,p*4))
        current['actual']=p*12345
        changed=make_bounds(previous,current,'m',.9,np.array(['cat','cat']))
        self.assertTrue(np.array_equal(hi,changed[1]));self.assertEqual(q,changed[2])
        with self.assertRaisesRegex(ValueError,'overlaps'):past_only(previous,127)

    def test_coverage_levels_nested_after_nonnegative_clipping(self):
        p=np.ones((2,28));previous=[{'origin':100,'actual':np.arange(56).reshape(2,28),'predictions':{'m':p},'scale':np.ones(2)}]
        current={'origin':128,'predictions':{'m':p},'scale':np.ones(2)}
        a,b,_=make_bounds(previous,current,'m',.8,np.array(['c','c']))
        c,d,_=make_bounds(previous,current,'m',.9,np.array(['c','c']))
        self.assertTrue((c<=a).all());self.assertTrue((d>=b).all())

    def test_sparse_acceleration_matches_original_features_and_excludes_views(self):
        ids=[str(i).zfill(4) for i in range(400)]
        views=pd.DataFrame([['s1',ids[0],'2021-01-01'],['s2',ids[1],'2021-01-01']],columns=['session_id','item_id','date'])
        purchases=pd.DataFrame([['s1',ids[2],'2021-01-02'],['s2',ids[3],'2021-01-02']],columns=['session_id','item_id','date'])
        attrs=pd.DataFrame([[item,str(k),str((i+k)%7)] for i,item in enumerate(ids) for k in range(3)],columns=['item_id','feature_category_id','feature_value_id'])
        model=SessionBaselines().fit(views,purchases,attrs);engine=RetrievalEngine(model,ids);sequence=[ids[0],ids[1],ids[0]]
        original,x0,channels0=candidate_features(model,sequence,ids)
        x,channels=engine.signals(sequence);pool,x1=engine.candidates(x,channels,100)
        self.assertEqual(original,pool);np.testing.assert_allclose(x0,x1,rtol=1e-6,atol=1e-7)
        for key,value in channels0.items():self.assertEqual(value,[engine.items[j] for j in channels[key][:100]])
        wide,_=engine.candidates(x,channels,300,50)
        self.assertTrue(set(pool)<=set(wide));self.assertFalse(set(sequence)&set(wide))

if __name__=='__main__':unittest.main()

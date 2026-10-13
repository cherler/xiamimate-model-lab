import unittest
import numpy as np
from services.classification.run import grouped_split, confusion, calibration_bins, metrics, choose_threshold, capacity_order, rules_score, assert_close

class ClassificationTest(unittest.TestCase):
    def test_groups_never_cross_partitions(self):
        x=np.tile(np.arange(400).reshape(100,4),(3,1))
        groups,splits=grouped_split(x,42,{'train':[0,6000],'calibration':[6000,7500],'validation':[7500,8500],'test':[8500,10000]})
        self.assertEqual(sum(map(len,splits.values())),len(x))
        seen=set()
        for ids in splits.values():
            current=set(groups[ids]);self.assertFalse(seen & current);seen|=current
        self.assertEqual(len(seen),100)
    def test_threshold_uses_fpr_constraint_and_supports_none(self):
        y=np.array([0,0,1,1]);p=np.array([.2,.8,.5,.9])
        threshold=choose_threshold(y,p)
        self.assertEqual(threshold,.9)
        self.assertEqual(confusion(y,p>=threshold)['fpr'],0)
        threshold=choose_threshold(y,np.ones(4))
        self.assertGreater(threshold,1)
        self.assertIsNone(confusion(y,np.zeros(4,dtype=bool))['precision'])
    def test_calibration_endpoints_and_empty_bins(self):
        m=metrics(np.array([0,1,0,1]),np.array([0,1,.2,.8]))
        self.assertEqual(sum(b['n'] for b in m['bins']),4)
        self.assertEqual(m['bins'][0]['n'],1);self.assertEqual(m['bins'][-1]['n'],1)
        self.assertIsNone(m['bins'][5]['positive_rate'])
        self.assertAlmostEqual(m['brier'],.02)
        self.assertAlmostEqual(m['ap'],1)
    def test_capacity_ties_use_group_then_id(self):
        order=capacity_order(np.array([.5,.5,.9,.5]),np.array(['b','a','c','a']),np.array([0,4,2,3]))
        self.assertEqual(order.tolist(),[2,3,1,0])
    def test_rules_are_predeclared_fraction_not_probability(self):
        x=np.array([[.5,19],[.1,20],[1,30]])
        np.testing.assert_array_equal(rules_score(x,['free','caps'],{'free':.5,'caps':20}),[.5,.5,1])
    def test_verification_rejects_metric_drift(self):
        assert_close({'a':[.1,None]}, {'a':[.1,None]})
        with self.assertRaises(ValueError):assert_close({'a':.1},{'a':.11})

if __name__=='__main__':unittest.main()

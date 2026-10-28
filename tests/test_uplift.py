import unittest
import numpy as np
from services.uplift.run import policy,contributions,random_contributions,estimate,summarize

class UpliftEvidenceTests(unittest.TestCase):
    def test_no_action_has_zero_increment(self):
        t=np.array([0,1,2]);y=np.array([1.,1.,1.])
        np.testing.assert_array_equal(contributions(t,y,np.zeros(3)),[0,0,0])
    def test_ipw_multiarm_uses_randomized_probabilities(self):
        t=np.array([0,1,2]);y=np.array([0.,1.,1.])
        self.assertEqual(estimate(contributions(t,y,np.ones(3)))['mean'],1)
        self.assertEqual(estimate(random_contributions(t,y,1))['mean'],1)
    def test_exact_budget_and_stable_ties(self):
        s=np.array([[.3,.1],[.1,.5],[.2,.2],[.2,.2]])
        np.testing.assert_array_equal(policy(s,.5),[1,2,0,0])
        np.testing.assert_array_equal(policy(s,.75),[1,2,1,0])
    def test_identical_policy_paired_interval_zero(self):
        t=np.array([0,1,2]*4);y=np.array([[1,0,0],[1,1,20],[0,0,0]]*4,float)
        scores={'t':np.ones((12,2)),'response':np.ones((12,2))}
        r=summarize(scores,t,y,.5,'t')
        self.assertEqual(r['outcomes']['spend']['vs_response']['hi'],0)
    def test_random_allocation_is_expected_not_tie_broken(self):
        t=np.array([0,1,2]*4);y=np.ones((12,3));scores={'random':np.zeros((12,2)),'response':np.ones((12,2))}
        r=summarize(scores,t,y,.5,'random')
        self.assertEqual(r['arms'],[6,3,3]);self.assertEqual(r['allocation_kind'],'expected_random')
    def test_constant_effect_large_balanced_experiment(self):
        t=np.tile([0,1,2],1000);y=np.where(t==0,2,np.where(t==1,3,5))
        self.assertAlmostEqual(estimate(contributions(t,y,np.full(len(t),2)))['mean'],3)

if __name__=='__main__':unittest.main()

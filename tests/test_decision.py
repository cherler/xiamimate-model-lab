import itertools
import unittest
import numpy as np
from services.decision.core import optimize, metrics, rule, inputs

class DecisionTest(unittest.TestCase):
    def example(self):
        return {'initial':np.array([1,0]),'cost':np.array([2,3]),'holding':np.array([.2,.3]),'penalty':np.array([6,9]),'demand':np.array([[1.,5.],[2.,4.]]),'prediction':np.array([3.,3.]),'pack':2,'budget':14,'capacity':9,'ids':['a','b']}
    def test_optimum_matches_exhaustive_search(self):
        x=self.example();valid=[metrics(x,q)['total_cost'] for q in itertools.product(range(6),repeat=2) if metrics(x,q)['feasible']]
        solved=optimize(x,{'time_limit':10,'mip_rel_gap':1e-8})
        self.assertAlmostEqual(solved['objective'],min(valid));self.assertTrue(metrics(x,solved['packs'])['feasible'])
    def test_rules_obey_constraints_and_integrality(self):
        for budget,capacity in itertools.product([0,1,5,14,100],[1,2,6,9]):
            x=self.example();x.update(budget=budget,capacity=capacity)
            for buffer in [False,True]:self.assertTrue(metrics(x,rule(x,buffer))['feasible'])
    def test_zero_demand_and_no_resources(self):
        x=self.example();x['demand'][:]=0;x['prediction'][:]=0
        self.assertEqual(optimize(x,{})['packs'],[0,0]);self.assertIsNone(metrics(x,[0,0])['fill_rate'])
        x=self.example();x.update(budget=0,capacity=1)
        self.assertEqual(optimize(x,{})['packs'],[0,0])
    def test_cost_accounting(self):
        x=self.example();m=metrics(x,[1,1],[4,1])
        self.assertEqual(m['purchase'],10);self.assertAlmostEqual(m['holding'],.3);self.assertEqual(m['shortage_cost'],6)
        self.assertAlmostEqual(m['total_cost'],16.3);self.assertEqual(m['shortage_units'],1);self.assertEqual(m['fill_rate'],.8)
        self.assertFalse(metrics(x,[1.1,1])['feasible'])
    def test_outcomes_do_not_enter_decision_inputs(self):
        cfg={'holding_purchase_ratio':.1,'pack_size':6}
        a={'id':'a','weeks':[1]*8,'initial':0,'cost':10,'price':20,'predictions':{'m':2},'actual':999}
        x=inputs([a],'m',1,1,1,cfg);a['actual']=0;y=inputs([a],'m',1,1,1,cfg)
        np.testing.assert_array_equal(x['demand'],y['demand']);self.assertEqual(x['budget'],y['budget'])
    def test_infeasible_constraints_raise(self):
        x=self.example();x['capacity']=0
        with self.assertRaises(RuntimeError):optimize(x,{})

if __name__=='__main__':unittest.main()

import copy
import unittest
from services.decision_study.audit import source,audit

class DecisionServiceAuditTest(unittest.TestCase):
    def test_frozen_scope_and_original_metrics(self):
        p,before=source();a=audit(p)
        self.assertEqual((a['verified_plans'],a['item_windows'],len(a['rows'])),(432,144,24))
        self.assertTrue(all('actual' not in r for w in before for r in w['items']))
        self.assertEqual(sum(r['above_item_range'] for r in a['rows'] if r['model']=='lightgbm'),17)
    def test_changed_cost_evidence_is_rejected(self):
        p,_=source();p=copy.deepcopy(p);p['windows'][0]['plans'][0]['policies']['point']['expected']['total_cost']+=1
        with self.assertRaises(AssertionError):audit(p)

class DecisionServiceSolverTest(unittest.TestCase):
    def example(self):
        import numpy as np
        return {'initial':np.array([1,0]),'cost':np.array([2,3]),'holding':np.array([.2,.3]),'penalty':np.array([6,9]),'demand':np.array([[1.,5.],[2.,4.]]),'prediction':np.array([3.,3.]),'pack':2,'budget':14,'capacity':9,'ids':['a','b']}
    def test_service_optimum_and_ceiling_match_exhaustive_search(self):
        import itertools
        from services.decision.core import metrics
        from services.decision_study.solver import solve
        x=self.example();options={'time_limit':10,'mip_rel_gap':1e-8}
        rows=[metrics(x,q) for q in itertools.product(range(6),repeat=2) if metrics(x,q)['feasible']]
        top=solve(x,options,max_service=True)
        self.assertAlmostEqual(top['expected']['fill_rate'],max(m['fill_rate'] for m in rows))
        for target in [0,.5,.7,.8,.9,1]:
            eligible=[m for m in rows if m['fill_rate']>=target-1e-8];s=solve(x,options,target)
            if eligible:
                self.assertEqual(s['status'],0);self.assertAlmostEqual(s['objective'],min(m['total_cost'] for m in eligible))
            else:self.assertEqual(s['status'],2);self.assertIsNone(s['packs'])
    def test_zero_demand_and_invalid_targets(self):
        from services.decision_study.solver import solve
        x=self.example();x['demand'][:]=0;x['budget']=0;x['capacity']=1
        r=solve(x,{},1);self.assertEqual(r['status'],0);self.assertIsNone(r['expected']['fill_rate'])
        for target in [-1,1.1,float('nan')]:
            with self.assertRaises(ValueError):solve(x,{},target)
    def test_actuals_never_enter_solve(self):
        from services.decision.core import inputs
        from services.decision_study.solver import solve
        cfg={'holding_purchase_ratio':.1,'pack_size':6}
        a={'id':'a','weeks':[12]*8,'initial':0,'cost':10,'price':20,'predictions':{'m':12},'actual':999}
        x=inputs([a],'m',1,1,1,cfg);a['actual']=0;y=inputs([a],'m',1,1,1,cfg)
        self.assertEqual(solve(x,{},.8)['packs'],solve(y,{},.8)['packs'])
    def test_timeout_does_not_become_infeasibility_or_fallback(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        from services.decision_study.solver import solve
        with patch('services.decision_study.solver.milp',return_value=SimpleNamespace(status=1,message='time limit')):
            r=solve(self.example(),{},.8)
            self.assertEqual(r['status'],1);self.assertIsNone(r['packs']);self.assertIsNone(r['expected'])

class DecisionServiceArtifactTest(unittest.TestCase):
    def test_all_published_orders_match_cost_and_constraints(self):
        from services.monitoring.common import load
        from services.decision_study.audit import ROOT
        from services.decision_study.run import verify
        parent,_=source();m=load(ROOT/'apps/web/decision-service-results/manifest.json');p=load(ROOT/'apps/web/decision-service-results'/m['path'])
        self.assertIs(verify(p,parent),p)
        self.assertEqual(sum(s['status']==0 for r in p['records'] for s in r['services']),92)
        self.assertTrue(all(s['status']==2 for r in p['records'] for s in r['services'] if s['target']==.9))
    def test_infeasible_order_and_missing_scope_rejected(self):
        from services.monitoring.common import load
        from services.decision_study.audit import ROOT
        from services.decision_study.run import verify
        parent,_=source();m=load(ROOT/'apps/web/decision-service-results/manifest.json');p=load(ROOT/'apps/web/decision-service-results'/m['path'])
        q=copy.deepcopy(p);q['records'].pop()
        with self.assertRaises(ValueError):verify(q,parent)
        q=copy.deepcopy(p);s=next(s for r in q['records'] for s in r['services'] if s['status']==2);s['packs']=[0]*12
        with self.assertRaises(ValueError):verify(q,parent)

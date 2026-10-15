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

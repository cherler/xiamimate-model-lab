import copy
import json
import unittest
from services.reliability.uci import evaluate, interval_metrics, quantile, scale, PROTOCOL
from services.reliability.uci_audit import load, audit

class UciReliabilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest,cls.data=load();cls.rows=cls.data['weekly-series.json'];cls.p=json.loads(PROTOCOL.read_text());cls.result=evaluate(cls.rows,cls.p)
    def test_audit_counts_complete_targets_and_rejects_history_leakage(self):
        a=audit(self.manifest,self.data)
        self.assertEqual(a['tasks']['weekly']['eligible_windows'],8)
        self.assertEqual(a['tasks']['daily']['eligible_windows'],0)
        bad=copy.deepcopy(self.data);bad['weekly-series.json'][0]['history_dates'][-1]=bad['weekly-series.json'][0]['origin']
        with self.assertRaises(ValueError):audit(self.manifest,bad)
    def test_current_and_future_labels_cannot_change_current_interval(self):
        origin='2011-10-15';changed=copy.deepcopy(self.rows)
        for r in changed:
            if r['origin']>=origin:r['actual']+=10000
        result=evaluate(changed,self.p)
        old=[r['intervals'] for r in self.result['records'] if r['origin']<=origin]
        new=[r['intervals'] for r in result['records'] if r['origin']<=origin]
        self.assertEqual(old,new)
        self.assertNotEqual([r['intervals'] for r in self.result['records'] if r['origin']=='2011-11-01'],[r['intervals'] for r in result['records'] if r['origin']=='2011-11-01'])
    def test_quantile_is_corrected_order_statistic_and_small_pool_is_unavailable(self):
        self.assertIsNone(quantile([1]*8));self.assertEqual(quantile(list(range(48))),44)
        self.assertEqual(scale({'history':[0]*56}),1)
    def test_shared_scope_counts_misses_and_retains_warmup(self):
        windows=self.result['windows'];self.assertTrue(all(w['quantiles'] is None for w in windows[:4]))
        self.assertEqual([w['calibration_n'] for w in windows[4:]],[48,60,72,84,96,108,120,132])
        for m,v in self.result['summary'].items():
            s=v['interval'];self.assertEqual(s['n'],96);self.assertEqual(s['n'],s['covered']+s['below']+s['above'])
        self.assertEqual(self.result['summary']['lightgbm']['interval']['covered'],86)
        self.assertEqual(self.result['summary']['four_week_median']['interval']['covered'],88)
    def test_interval_score_penalizes_width_and_both_miss_directions(self):
        rows=[{'actual':y,'scale':2,'intervals':{'m':{'lower':2,'upper':4}}} for y in [1,3,5]]
        s=interval_metrics(rows,'m');self.assertEqual(s['covered'],1);self.assertEqual(s['below'],1);self.assertEqual(s['above'],1)
        self.assertAlmostEqual(s['interval_score'],(22+2+22)/3);self.assertEqual(s['mean_scaled_width'],1)

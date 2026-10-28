import unittest
import numpy as np
from services.anticheat.features import extract,features,NAMES
from services.anticheat.metrics import threshold,counts

class AntiCheatTest(unittest.TestCase):
    def test_future_and_outcome_fields_do_not_enter_features(self):
        a=np.zeros((100,6));a[:,4]=np.arange(100)*.01
        ammo=np.ones(100)*30;ammo[40:]=29;ammo[80:]=28
        d={'actions':a.tolist(),'ammos':ammo.tolist(),'weapons':[2]*100,'damages':[0]*100}
        w,t=extract(d);self.assertEqual(t.tolist(),[40,80]);before=w[0].copy()
        a[40:,:]=999;d['actions']=a.tolist();d['damages']=[999]*100;d['aimbot']='gan_group1'
        np.testing.assert_equal(extract(d)[0][0],before)
    def test_changed_weapon_not_a_shot_and_no_overlapping_windows(self):
        d={'actions':np.ones((90,6)).tolist(),'ammos':[30]*40+[29]*5+[28]*45,'weapons':[2]*40+[3]*50}
        self.assertEqual(len(extract(d)[0]),0)
    def test_features_reject_corruption(self):
        x=features(np.zeros((2,35,2)));self.assertEqual(x.shape,(2,len(NAMES)));self.assertTrue(np.isfinite(x).all())
        with self.assertRaises(ValueError):features(np.full((1,35,2),np.nan))
    def test_threshold_ties_and_small_support(self):
        for n in [8,100,1000]:
            s=np.repeat([0.,1.],n//2);cut=threshold(s,.01)
            self.assertLessEqual(int((s>=cut).sum()),int(np.floor(len(s)*.01)))
        self.assertEqual(counts([0,1],[.8,.7],.75)['fp'],1)
        self.assertEqual(counts([0,1],[.8,.7],.75)['fn'],1)

if __name__=='__main__':unittest.main()

class FrozenAntiCheatEvidenceTest(unittest.TestCase):
    def test_saved_report_uses_same_thresholds_and_cohorts(self):
        import json
        from pathlib import Path
        root=Path(__file__).resolve().parents[1]
        folder=root/'artifacts/anticheat-runs/vizdoom-aim-v1'
        if not (folder/'report.json').exists():self.skipTest('Local research artifacts absent')
        corrected=folder.with_name(folder.name+'-threshold-fix')
        report=json.loads((corrected/'report.json').read_text());frozen=json.loads((corrected/'frozen.json').read_text());split=json.loads((folder/'split.json').read_text())
        d=np.load(root/'data/anticheat/prepared.npz');scores=np.load(folder/'scores.npz');ids=np.array(split['test']);kinds=d['kinds'][ids];y=kinds!='none'
        known=np.isin(kinds,['none','ease_light','ease_strong'])
        for model in report['protocol']['models']:
            self.assertLessEqual(frozen['calibration'][model]['fpr'],.01)
            for field,mask in [('all',np.ones(len(y),dtype=bool)),('known',known)]:
                actual=counts(y[mask],scores[model][mask],frozen['thresholds'][model])
                for k,v in actual.items():self.assertEqual(v,report['models'][model][field][k])
        self.assertEqual(len(np.unique(d['groups'][ids][kinds=='gan_group1'])),1)

class ThresholdPrecisionTest(unittest.TestCase):
    def test_float32_threshold_is_strict_in_score_dtype(self):
        from services.anticheat.recalibrate import strict_cut
        for dtype in [np.float32,np.float64]:
            values=np.linspace(0,1,2135,dtype=dtype)
            cut=strict_cut(values)
            self.assertEqual(int((values>=cut).sum()),21)
            tied=np.ones(2135,dtype=dtype)
            self.assertEqual(int((tied>=strict_cut(tied)).sum()),0)

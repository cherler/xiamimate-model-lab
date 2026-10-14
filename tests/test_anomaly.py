import unittest
import numpy as np
import pandas as pd
from services.monitoring.anomaly import causal_features, evaluate


class AnomalyTests(unittest.TestCase):
    def test_features_exclude_current_from_history_and_future_from_everything(self):
        times=pd.date_range('2020-01-01',periods=80,freq='h');values=np.arange(80,dtype=float)
        a,s,med=causal_features(times,values,.1)
        self.assertEqual(a[24,2],11.5);self.assertEqual(med[24],11.5)
        edited=values.copy();edited[41:]=10000
        b,t,_=causal_features(times,edited,.1)
        np.testing.assert_allclose(a[:41],b[:41]);np.testing.assert_allclose(s[:41],t[:41])

    def rows(self):
        return [{'t':i*60000,'scores':{'static':float(i in [1,2,4,7])}} for i in range(10)]

    def test_cooldown_changes_events_not_raw_point_metrics(self):
        windows=[{'start':2*60000,'end':4*60000},{'start':8*60000,'end':9*60000}]
        a=evaluate(self.rows(),windows,'static',.5,0);b=evaluate(self.rows(),windows,'static',.5,3)
        self.assertEqual((a['tp'],a['fp'],a['fn'],a['tn']),(2,2,3,3));self.assertEqual(a['detected_events'],1)
        self.assertEqual((a['tp'],a['fp']),(b['tp'],b['fp']));self.assertEqual(len(b['alerts']),3)
        self.assertEqual(b['events'][0]['delay_minutes'],2);self.assertFalse(b['events'][1]['detected']);self.assertIsNone(b['events'][1]['delay_minutes'])
        self.assertEqual(a['duplicate_event_alerts'],1)

    def test_equality_no_alert_no_event_and_no_positive_are_explicit(self):
        m=evaluate(self.rows(),[],'static',1,60)
        self.assertEqual(m['alert_count'],0);self.assertIsNone(m['precision']);self.assertIsNone(m['event_recall']);self.assertIsNone(m['ap'])
        with self.assertRaises(ValueError):evaluate(self.rows(),[],'static',float('nan'))

import unittest
import numpy as np
import pandas as pd
from services.monitoring.segments import rfm_at, rule_labels, future_at, profiles, transitions


class SegmentTests(unittest.TestCase):
    def fixture(self):
        return pd.DataFrame({'date':pd.to_datetime(['2011-08-01','2011-08-01','2011-09-01','2011-10-01']),
                             'customer':['a']*4,'invoice':['1','1','2','3'],'quantity':[1,2,3,4],'price':[10]*4})

    def test_origin_is_excluded_and_lines_do_not_inflate_order_count(self):
        r=rfm_at(self.fixture(),'2011-09-01');self.assertEqual(r.loc['a'].tolist(),[31,1,30])
        f=self.fixture();f.loc[f.date>=pd.Timestamp('2011-09-01'),'quantity']=99999
        pd.testing.assert_frame_equal(r,rfm_at(f,'2011-09-01'))
        self.assertEqual(future_at(self.fixture(),['a'],'2011-09-01').loc['a'].tolist(),[1,30])

    def test_rules_have_frozen_precedence_and_boundaries(self):
        self.assertEqual(rule_labels(np.array([[91,1,1],[90,1,1],[30,3,1],[31,3,1],[30,2,1]])).tolist(),[0,1,2,3,3])

    def test_profiles_use_all_members_and_gross_not_median_share(self):
        rows=[{'id':'a','rfm':[1,2,100],'cluster':0,'future_orders':1,'future_gross':5},
              {'id':'b','rfm':[3,1,300],'cluster':0,'future_orders':0,'future_gross':0}]
        p=profiles(rows,'cluster');self.assertEqual(p[0]['n'],2);self.assertEqual(p[0]['sales_share'],1)
        self.assertEqual(p[0]['future_return_rate'],.5);self.assertIsNone(p[1]['median_rfm'])

    def test_temporal_population_changes_not_counted_as_migrations(self):
        a=[{'id':'a','cluster':0},{'id':'b','cluster':1}];b=[{'id':'a','cluster':2},{'id':'c','cluster':1}]
        t=transitions(a,b,'cluster');self.assertEqual((t['common'],t['entered'],t['exited']),(1,1,1));self.assertEqual(t['matrix'][0][2],1);self.assertEqual(t['same_share'],0)

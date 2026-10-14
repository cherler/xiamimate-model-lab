import unittest
import numpy as np
import pandas as pd
from scipy import sparse
from services.segmentation.run import historical, matrix, feature_fit, feature_transform, graph_edges, graph_fit, agreement, summary, top_products, future_stats


class PreferenceTests(unittest.TestCase):
    def test_snapshot_and_catalog_exclude_future_and_unseen_products(self):
        rows=[]
        for u in range(8):
            for item in ['a','b' if u<4 else 'c']:
                rows.append([str(u),str(u),item,'2011-08-31'])
        rows.append(['0','future','future','2011-09-01'])
        frame=pd.DataFrame(rows,columns=['customer','invoice','item','date']);frame.date=pd.to_datetime(frame.date)
        past=historical(frame,'2011-09-01',180)
        fitted,x,z=feature_fit(past,[str(u) for u in range(8)],{'min_item_customers':2,'svd_dimensions':2,'seed':42})
        self.assertNotIn('future',fitted['catalog']);self.assertEqual(x.shape,(8,3))
        # Duplicate line within an invoice must not increase purchase frequency.
        duplicate=pd.concat([past,past.iloc[:1]]);np.testing.assert_array_equal(matrix(duplicate,[str(u) for u in range(8)],fitted['catalog']).toarray(),x.toarray())
        unknown=pd.DataFrame([['new','invoice','unseen',pd.Timestamp('2011-09-02')]],columns=frame.columns)
        xx,zz=feature_transform(unknown,['new'],fitted)
        self.assertEqual(xx.nnz,0);self.assertEqual(float(np.linalg.norm(zz)),0)

    def test_graph_is_undirected_positive_no_self_edges_and_reproducible(self):
        z=np.array([[1,0],[.99,.1],[0,1],[.1,.99],[-1,0]],float)
        edges,weights=graph_edges(z,2)
        self.assertEqual(len(edges),len(set(edges)))
        self.assertTrue(all(a<b for a,b in edges));self.assertTrue(all(w>0 for w in weights))
        cfg={'graph':{'neighbors':2,'resolution':1.,'iterations':-1}}
        a,_=graph_fit(z,cfg,42);b,_=graph_fit(z,cfg,42)
        np.testing.assert_array_equal(a,b)

    def test_noise_and_single_group_do_not_become_accuracy(self):
        a=agreement([-1,-1,0,0],[-1,-1,0,1]);self.assertEqual(a['jointly_assigned'],2)
        result=summary(np.array([-1,-1,0,0]),np.eye(4),[0,1,2,3])
        self.assertEqual(result['unassigned'],2);self.assertIsNone(result['silhouette']);self.assertEqual(result['silhouette_n'],2)

    def test_future_comparison_keeps_all_targets_and_same_assigned_cohort(self):
        frame=pd.DataFrame([['u','a','2011-09-02'],['u','outside','2011-09-03'],['v','a','2011-09-02']],columns=['customer','item','date']);frame.date=pd.to_datetime(frame.date)
        labels={'method':np.array([0,-1])};profiles={'method':[{'id':0,'top':[{'item':'a'}]},{'id':-1,'top':[]}]}
        r=future_stats(frame,'2011-09-01',['u','v'],labels,profiles,{'outside'},30)['method']
        self.assertEqual(r['returning'],2);self.assertEqual(r['evaluated'],1);self.assertEqual(r['unassigned_returning'],1)
        self.assertEqual(r['group_recall'],.5);self.assertEqual(r['global_recall'],.5)

    def test_product_prevalence_counts_customers_not_order_volume(self):
        x=sparse.csr_matrix([[10,0],[1,1],[0,4]])
        rows=top_products(x,np.array([0,1]),['a','b'],{'a':'A','b':'B'},2)
        self.assertEqual(rows[0]['customers'],2);self.assertEqual(rows[0]['share'],1);self.assertEqual(rows[0]['lift'],1.5)

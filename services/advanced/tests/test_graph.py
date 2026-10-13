import sys
from pathlib import Path
import unittest
import numpy as np
from scipy import sparse
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from graph import LightGCN,normalized_graph,negative_items,fit_graph

class GraphTests(unittest.TestCase):
    def test_normalization_and_layer_average(self):
        x=sparse.csr_matrix([[1.,1.],[0.,1.]])
        a=normalized_graph(x).to_dense().numpy()
        self.assertAlmostEqual(a[0,2],1/np.sqrt(2),places=6)
        self.assertAlmostEqual(a[0,3],.5,places=6)
        np.testing.assert_array_equal(a,a.T);self.assertTrue(np.all(a[:2,:2]==0))
        model=LightGCN(2,2,1,1)
        with torch.no_grad():model.embedding.weight.copy_(torch.arange(4).float().reshape(4,1))
        u,i=model.propagate(normalized_graph(x));expected=(np.arange(4)+a@np.arange(4))/2
        np.testing.assert_allclose(torch.cat([u,i]).detach().numpy().ravel(),expected,atol=1e-6)
    def test_unobserved_negatives_and_determinism(self):
        x=sparse.csr_matrix([[1.,0.,0.],[0.,1.,0.]])
        users=np.tile([0,1],100);neg=negative_items(x,users,np.random.default_rng(42))
        self.assertTrue(np.all(np.asarray(x[users,neg]).ravel()==0))
        cfg={'dimensions':4,'layers':2,'epochs':3,'batch_size':8,'learning_rate':.01,'regularization':.0001}
        _,u,i,trace=fit_graph(x,cfg,42);_,u2,i2,_=fit_graph(x,cfg,42)
        np.testing.assert_array_equal(u,u2);np.testing.assert_array_equal(i,i2);self.assertTrue(np.isfinite(trace).all())

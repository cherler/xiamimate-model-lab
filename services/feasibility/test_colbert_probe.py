import unittest
import torch
from colbert_probe import maxsim
class MaxSimTests(unittest.TestCase):
    def test_sum_of_per_query_best_matches_not_mean_pooling(self):
        q=torch.tensor([[1.,0.],[0.,1.],[-1.,0.]])
        d=torch.tensor([[1.,0.],[0.,1.]])
        self.assertEqual(float(maxsim(q,d)),2.)
        self.assertEqual(float(maxsim(q,d.flip(0))),2.)
        self.assertEqual(float(maxsim(q,torch.cat([d,d]))),2.)
    def test_negative_similarities_preserved(self):
        self.assertEqual(float(maxsim(torch.tensor([[1.,0.]]),torch.tensor([[-1.,0.]]))),-1.)
if __name__=='__main__':unittest.main()

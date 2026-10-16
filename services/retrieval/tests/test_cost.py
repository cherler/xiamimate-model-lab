import unittest
import numpy as np
import torch
from services.retrieval.cost_study import document_scores, maxsim, summaries
from services.retrieval.core import metrics


class RetrievalCostTest(unittest.TestCase):
    def test_padding_is_not_a_match_even_when_real_similarities_negative(self):
        q=torch.tensor([[1.,0.]])
        vectors=torch.tensor([[[-1.,0.],[0.,0.]]]);mask=torch.tensor([[True,False]])
        self.assertEqual(float(maxsim(q,vectors,mask)[0]),-1.)

    def test_blocked_full_and_subset_scan_match_reference_max_chunk(self):
        torch.manual_seed(1);q=torch.randn(4,3);v=torch.randn(5,7,3);mask=torch.ones(5,7,dtype=torch.bool);mask[2,4:]=False
        index={'vectors':v,'mask':mask,'docchunks':[[0,1],[2],[3,4]],'chunkdocs':np.array([0,0,1,2,2])}
        expected=np.array([max(float((q@v[i][mask[i]].T).max(1).values.sum()) for i in cc) for cc in index['docchunks']])
        for block in [1,2,64]:
            actual=document_scores(q,index,block=block);np.testing.assert_allclose(actual,expected,rtol=1e-6)
            subset=document_scores(q,index,[2,0],block=block);np.testing.assert_allclose(subset[[2,0]],expected[[2,0]],rtol=1e-6);self.assertTrue(np.isneginf(subset[1]))

    def test_p95_uses_pipeline_totals_not_sum_of_component_percentiles(self):
        rows=[]
        for i in range(4):
            rank=['yes','no'];m=metrics(rank,{'yes':1})
            rows.append({'relevant':{'yes':1},'outside50':['yes'],'rankings':{'a':rank,'b':rank},'metrics':{'a':m,'b':m},
                'timing':{k:{'total_ms':101,'components_ms':{'x':100 if i%2 else 1,'y':1 if i%2 else 100}} for k in ['a','b']}})
        result=summaries(rows,{'methods':['a','b'],'comparisons':[['a','b']],'seed':42})
        self.assertEqual(result['timing']['a']['p95_ms'],101)
        self.assertEqual(result['comparisons'][0]['delta'],0)
        self.assertEqual(result['comparisons'][0]['lost_targets10'],0)
        self.assertEqual(result['outside50']['a']['found10'],4)


if __name__=='__main__':unittest.main()

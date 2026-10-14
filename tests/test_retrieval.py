import math
import unittest
import numpy as np
from services.retrieval.core import BM25, tokens, ordered, fuse, rerank_with_tail, metrics


class RetrievalTests(unittest.TestCase):
    def test_bm25_hand_calculation_and_query_term_dedup(self):
        index = BM25(['a a b', 'b c'])
        expected = math.log(1 + 1.5 / 1.5) * 2 * 2.2 / (2 + 1.2 * (.25 + .75 * 3 / 2.5))
        np.testing.assert_allclose(index.score('A a'), [expected, 0])
        np.testing.assert_allclose(index.score('unknown'), [0, 0])
        self.assertEqual(tokens('IL-6 / Science.'), ['il', '6', 'science'])

    def test_order_ties_and_invalid_scores(self):
        self.assertEqual(ordered(['z', 'a', 'b'], [1, 1, 2]), [('b', 2), ('a', 1), ('z', 1)])
        with self.assertRaises(ValueError):
            ordered(['a'], [float('nan')])

    def test_fusion_uses_only_candidates_and_rank(self):
        result = fuse([('b', 100), ('a', 99)], [('c', -1), ('a', -2)])
        self.assertEqual([x[0] for x in result], ['a', 'b', 'c'])
        self.assertAlmostEqual(result[0][1], 2 / 62)

    def test_reranking_preserves_pool_and_tail(self):
        h = [(str(i), i) for i in range(100)]
        result = rerank_with_tail(h, list(range(50)))
        self.assertEqual(result[50:], h[50:])
        self.assertEqual(set(d for d, _ in result[:50]), set(d for d, _ in h[:50]))
        self.assertEqual(result[0][0], '49')
        with self.assertRaises(ValueError):
            rerank_with_tail(h, [1])

    def test_metrics_hand_calculation_and_unretrieved_targets(self):
        m = metrics(['x', 'a', 'b'], {'a': 1, 'missing': 1})
        self.assertAlmostEqual(m['ndcg_at_10'], (1/math.log2(3)) / (1+1/math.log2(3)))
        self.assertEqual(m['recall_at_10'], .5)
        self.assertEqual(m['mrr_at_10'], .5)
        self.assertEqual(metrics(['x'], {'a': 1})['ndcg_at_10'], 0)
        with self.assertRaises(ValueError):
            metrics(['a', 'a'], {'a': 1})
        with self.assertRaises(ValueError):
            metrics(['a'], {})

"""Label-free retrieval primitives and independent ranking metrics."""
import math
import re
from collections import Counter
import numpy as np
from scipy import sparse

METHODS = ('bm25', 'dense', 'hybrid', 'rerank')


def tokens(text):
    return re.findall(r'[a-z0-9]+', text.lower())


def ordered(ids, scores, k=100):
    if len(ids) != len(scores) or not np.isfinite(scores).all():
        raise ValueError('Invalid scores')
    return sorted(zip(ids, map(float, scores)), key=lambda p: (-p[1], p[0]))[:k]


class BM25:
    def __init__(self, texts, k1=1.2, b=.75):
        counts = [Counter(tokens(t)) for t in texts]
        self.vocab = {w: i for i, w in enumerate(sorted({w for c in counts for w in c}))}
        lengths = np.array([sum(c.values()) for c in counts])
        average = lengths.mean()
        if not average:
            raise ValueError('Empty corpus')
        df = Counter(w for c in counts for w in c)
        rows, cols, values = [], [], []
        for i, c in enumerate(counts):
            norm = k1 * (1 - b + b * lengths[i] / average)
            for w, tf in c.items():
                rows.append(i); cols.append(self.vocab[w])
                values.append(math.log(1 + (len(texts) - df[w] + .5) / (df[w] + .5)) * tf * (k1 + 1) / (tf + norm))
        self.matrix = sparse.csr_matrix((values, (rows, cols)), shape=(len(texts), len(self.vocab)))

    def score(self, query):
        indices = [self.vocab[w] for w in set(tokens(query)) if w in self.vocab]
        return np.asarray(self.matrix[:, indices].sum(axis=1)).ravel()


def fuse(first, second, c=60, k=100):
    scores = {}
    for channel in (first, second):
        for rank, (doc, _) in enumerate(channel, 1):
            scores[doc] = scores.get(doc, 0) + 1 / (c + rank)
    return ordered(list(scores), list(scores.values()), k)


def rerank_with_tail(hybrid, scores, pool=50):
    if len(scores) != min(pool, len(hybrid)):
        raise ValueError('Wrong reranking pool')
    return ordered([doc for doc, _ in hybrid[:pool]], scores, pool) + hybrid[pool:]


def metrics(ranking, relevant):
    if not relevant or any(v <= 0 for v in relevant.values()):
        raise ValueError('Positive relevance targets required')
    if len(set(ranking)) != len(ranking):
        raise ValueError('Duplicate retrieval')
    gains = [relevant.get(doc, 0) for doc in ranking]
    ideal = sorted(relevant.values(), reverse=True)[:10]
    dcg = lambda seq: sum((2**v - 1) / math.log2(i + 2) for i, v in enumerate(seq))
    return {'ndcg_at_10': dcg(gains[:10]) / dcg(ideal),
            'recall_at_10': sum(v > 0 for v in gains[:10]) / len(relevant),
            'mrr_at_10': next((1 / (i + 1) for i, v in enumerate(gains[:10]) if v > 0), 0),
            'recall_at_50': sum(v > 0 for v in gains[:50]) / len(relevant),
            'recall_at_100': sum(v > 0 for v in gains[:100]) / len(relevant)}

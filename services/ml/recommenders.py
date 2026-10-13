"""CPU recommenders sharing one frozen catalog and one ranking policy."""
from __future__ import annotations
import time
import numpy as np
from scipy import sparse, linalg
from implicit.cpu.als import AlternatingLeastSquares
from ml.core import rank_items as legacy_rank, ranking_metrics
from ml.personalized import EXTRA_STRATEGIES, personal_scores

STRATEGIES = ['popular', 'itemcf', 'basket', 'als', 'ease']


def interaction_matrix(model):
    users = sorted(model['histories'])
    index = {item: i for i, item in enumerate(model['items'])}
    rows, cols = [], []
    for row, user in enumerate(users):
        for item in model['histories'][user]:
            if item in index:
                rows.append(row); cols.append(index[item])
    return users, sparse.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(users), len(index)))


def fit_als(x, params, seed=42, threads=2):
    # implicit accepts observed confidence C_ui, not alpha alone: C_ui = 1 + alpha.
    confidence = x.astype(np.float32).copy()
    confidence.data *= 1 + params['confidence_increment']
    estimator = AlternatingLeastSquares(factors=params['factors'], regularization=params['regularization'], iterations=params.get('iterations', 30), alpha=1, num_threads=threads, random_state=seed)
    estimator.fit(confidence, show_progress=False)
    return {'user_factors': estimator.user_factors, 'item_factors': estimator.item_factors}


def fit_ease(x, regularization):
    if regularization <= 0:
        raise ValueError('EASE regularization must be positive')
    gram = (x.T @ x).toarray().astype(np.float64)
    gram.flat[::gram.shape[0] + 1] += regularization
    precision = linalg.solve(gram, np.eye(gram.shape[0]), assume_a='pos', check_finite=False)
    weights = -precision / np.diag(precision)[None, :]
    np.fill_diagonal(weights, 0)
    return weights


def rank_items(model, user, strategy='itemcf', k=10, exclude=False, exploration=0):
    if strategy not in STRATEGIES + EXTRA_STRATEGIES:
        raise ValueError('Unknown strategy')
    if strategy not in ['als', 'ease', *EXTRA_STRATEGIES]:
        return legacy_rank(model, user, strategy, k, exclude, exploration)
    index = model.get('_item_index') or {s: i for i, s in enumerate(model['items'])}
    history = [index[s] for s in model['histories'].get(user, []) if s in index]
    popularity = np.asarray(model['popularity'], dtype=float)
    fallback = not history
    if fallback:
        score = popularity.copy()
    elif strategy in EXTRA_STRATEGIES:
        score = personal_scores(model, user, strategy)
    elif strategy == 'als':
        users = model.get('_user_index') or {s: i for i, s in enumerate(model['users'])}
        score = np.asarray(model['item_factors'] @ model['user_factors'][users[user]], dtype=float)
    else:
        score = model['ease_weights'][history].sum(axis=0)
    if not fallback:
        score = score + popularity / max(popularity.max(), 1) * 1e-9
    if exploration and not fallback:
        # Preserve signed model scores. Business-rule changes are outside the report policy.
        score = score / max(np.abs(score).max(), 1e-12) + exploration / 100 * .2 * (1 - popularity / max(popularity.max(), 1))
    if exclude:
        score[history] = -np.inf
    ranked = np.argsort(-score, kind='stable')
    return [int(i) for i in ranked if np.isfinite(score[i])][:k], score, fallback


def evaluate(model, targets, strategy, k=10):
    records, covered = [], set()
    vocabulary = set(model['items'])
    for user, target in targets.items():
        indices, _, fallback = rank_items(model, user, strategy, k)
        ranked = [model['items'][i] for i in indices]
        covered.update(ranked)
        records.append({'customer': user, 'cohort': 'warm' if model['histories'].get(user) else 'cold', 'target': sorted(target), 'ranked': ranked, 'oov_targets': len(target - vocabulary), 'fallback': fallback, **ranking_metrics(ranked, target, k)})
    summary = {key: float(np.mean([r[key] for r in records])) for key in ['recall', 'ndcg', 'hit_rate']}
    summary.update(users=len(records), catalog_coverage=len(covered) / len(vocabulary), target_catalog_coverage=1 - sum(r['oov_targets'] for r in records) / sum(len(r['target']) for r in records), fallback_users=sum(r['fallback'] for r in records))
    summary['cohorts'] = {}
    for cohort in ['warm', 'cold']:
        subset = [r for r in records if r['cohort'] == cohort]
        summary['cohorts'][cohort] = {'users': len(subset), **{k: float(np.mean([r[k] for r in subset])) if subset else None for k in ['recall', 'ndcg', 'hit_rate']}}
    return summary, records


def latency(model, strategy, users):
    timings = []
    for user in users[:5]:
        rank_items(model, user, strategy)
    for user in users[:100]:
        start = time.perf_counter(); rank_items(model, user, strategy)
        timings.append((time.perf_counter() - start) * 1000)
    return {'p50_ms': float(np.median(timings)), 'p95_ms': float(np.quantile(timings, .95)), 'samples': len(timings), 'scope': 'single CPU ranking call, excludes HTTP, warm process'}

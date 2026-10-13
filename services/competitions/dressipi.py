"""Data-independent preparation for Dressipi. No downloader or public exporter.

These baselines and metric adapter are not SIHG4SR and are not a trained result.
Use only a locally supplied, appropriately authorized dataset.
"""
from collections import Counter, defaultdict
from heapq import nsmallest
import numpy as np
import pandas as pd


def validate_tables(sessions, purchases, features):
    required = [(sessions, {'session_id', 'item_id', 'date'}),
                (purchases, {'session_id', 'item_id', 'date'}),
                (features, {'item_id', 'feature_category_id', 'feature_value_id'})]
    for table, cols in required:
        if not cols.issubset(table.columns) or table[list(cols)].isna().any().any():
            raise ValueError(f'missing/null fields: {sorted(cols)}')
    if purchases.session_id.duplicated().any():
        raise ValueError('one purchased target per session required')
    if set(sessions.session_id) != set(purchases.session_id):
        raise ValueError('sessions and targets do not align')
    if not (set(sessions.item_id) | set(purchases.item_id)).issubset(set(features.item_id)):
        raise ValueError('item features missing for observed items')
    last_view = sessions.assign(date=pd.to_datetime(sessions.date, utc=True, format='mixed')).groupby('session_id').date.max()
    purchase_time = pd.to_datetime(purchases.date, utc=True, format='mixed')
    if (purchase_time.to_numpy() < purchases.session_id.map(last_view).to_numpy()).any():
        raise ValueError('purchase precedes a view')


def temporal_split(sessions, purchases, cutoff='2021-04-01', end='2021-05-01'):
    """Whole sessions; training targets and views must both precede the cutoff.

    May and official leaderboard/final files are not used by this development adapter.
    Local candidates must come from the item catalogue, never validation target IDs.
    """
    start = pd.Timestamp(cutoff, tz='UTC')
    stop = pd.Timestamp(end, tz='UTC')
    views = sessions.copy()
    labels = purchases.copy()
    views['date'] = pd.to_datetime(views.date, utc=True, format='mixed')
    labels['date'] = pd.to_datetime(labels.date, utc=True, format='mixed')
    spans = views.groupby('session_id').date.agg(['min', 'max'])
    train_ids = set(spans.index[spans['max'] < start]) & set(labels.loc[labels.date < start, 'session_id'])
    valid_ids = set(spans.index[(spans['min'] >= start) & (spans['max'] < stop)]) & set(labels.loc[(labels.date >= start) & (labels.date < stop), 'session_id'])
    if train_ids & valid_ids:
        raise ValueError('session leakage')
    return tuple(table.loc[table.session_id.isin(ids)].copy()
                 for ids in [train_ids, valid_ids] for table in [views, labels])


def ranking_metrics(targets, rankings, candidates, k=100):
    """One target/session. Missing retrieval target remains a zero in all-session metrics."""
    if not 1 <= k <= 100 or not targets or set(rankings) != set(targets):
        raise ValueError('invalid cutoff or missing/extra query sessions')
    candidates = set(candidates)
    reciprocal = hits = eligible = 0
    for session, target in targets.items():
        ranked = rankings[session]
        if len(ranked) > k or len(ranked) != len(set(ranked)) or not set(ranked).issubset(candidates):
            raise ValueError('duplicates, out-of-candidate items or oversized ranking')
        eligible += target in candidates
        if target in ranked:
            hits += 1
            reciprocal += 1 / (ranked.index(target) + 1)
    return {f'mrr@{k}': reciprocal / len(targets), f'recall@{k}': hits / len(targets),
            'candidate_target_coverage': eligible / len(targets), 'sessions': len(targets)}


class SessionBaselines:
    """Frozen training-only popularity, view→purchase and anonymous-attribute signals."""
    def fit(self, sessions, purchases, features):
        validate_tables(sessions, purchases, features)
        self.popularity = Counter(purchases.item_id)
        self.links = defaultdict(Counter)
        targets = purchases.set_index('session_id').item_id.to_dict()
        for session, rows in sessions.groupby('session_id', sort=False):
            for item in set(rows.item_id):
                self.links[item][targets[session]] += 1
        self.attributes = defaultdict(set)
        self.attribute_items = defaultdict(set)
        for row in features.itertuples(index=False):
            attr = (row.feature_category_id, row.feature_value_id)
            self.attributes[row.item_id].add(attr)
            self.attribute_items[attr].add(row.item_id)
        return self

    def predict(self, item_sequence, candidates, method='cooccurrence', k=100):
        """item_sequence is chronological; the task's target has not been viewed yet."""
        if method not in ['popularity', 'cooccurrence', 'attributes']:
            raise ValueError('unknown baseline')
        scores = Counter()
        if method == 'cooccurrence':
            for age, item in enumerate(reversed(item_sequence)):
                links = self.links.get(item, {})
                denominator = sum(links.values()) or 1
                for candidate, count in links.items():
                    scores[candidate] += .8 ** age * count / denominator
        elif method == 'attributes':
            for age, item in enumerate(reversed(item_sequence)):
                attrs = self.attributes.get(item, set())
                shared = Counter(candidate for attr in attrs for candidate in self.attribute_items[attr])
                for candidate, count in shared.items():
                    scores[candidate] += .8 ** age * count / len(attrs | self.attributes[candidate])
        # Scores never update from another evaluation session; IDs deterministically break ties.
        available = set(candidates) - set(item_sequence)
        return nsmallest(k, available, key=lambda i: (-scores[i], -self.popularity[i], str(i)))

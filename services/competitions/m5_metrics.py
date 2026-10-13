"""Independent implementation of the M5 guide's twelve-level WRMSSE.

Use full 30,490-series inputs for official scope. A subset has different weights
and aggregates and must be labelled scope_wrmsse, never leaderboard WRMSSE.
"""
import numpy as np
import pandas as pd

LEVELS = [[], ['state_id'], ['store_id'], ['cat_id'], ['dept_id'],
          ['state_id', 'cat_id'], ['state_id', 'dept_id'],
          ['store_id', 'cat_id'], ['store_id', 'dept_id'],
          ['item_id'], ['state_id', 'item_id'], ['store_id', 'item_id']]


def scale_after_first_sale(history):
    history = np.asarray(history, dtype=np.float64)
    if history.ndim != 2 or history.shape[1] < 2 or not np.isfinite(history).all() or (history < 0).any():
        raise ValueError('history must be a finite nonnegative series-by-day matrix')
    active = history > 0
    first = active.argmax(axis=1)
    differences = np.diff(history, axis=1) ** 2
    mask = np.arange(history.shape[1] - 1)[None, :] >= first[:, None]
    count = mask.sum(axis=1)
    result = (differences * mask).sum(axis=1) / np.maximum(count, 1)
    result[~active.any(axis=1) | (count == 0)] = 0
    return result


class WRMSSE:
    def __init__(self, metadata, history, revenue_last_28):
        self.n = len(metadata)
        history = np.asarray(history, dtype=np.float64)
        revenue = np.asarray(revenue_last_28, dtype=np.float64)
        if metadata.duplicated(['store_id', 'item_id']).any():
            raise ValueError('duplicate bottom series')
        if history.shape[0] != self.n or revenue.shape != (self.n,) or not np.isfinite(revenue).all() or (revenue < 0).any() or revenue.sum() <= 0:
            raise ValueError('invalid history/revenue alignment or weights')
        self.levels = []
        for keys in LEVELS:
            codes = (pd.MultiIndex.from_frame(metadata[keys]).factorize(sort=True)[0]
                     if keys else np.zeros(self.n, dtype=int))
            count = int(codes.max()) + 1
            aggregated = self.aggregate(history, codes, count)
            scale = scale_after_first_sale(aggregated)
            weights = np.bincount(codes, weights=revenue, minlength=count) / revenue.sum()
            if ((scale <= 0) & (weights > 0)).any():
                raise ValueError('positive-weight constant series has undefined RMSSE; do not silently add epsilon')
            self.levels.append((codes, count, scale, weights))

    @staticmethod
    def aggregate(values, codes, count):
        result = np.zeros((count, values.shape[1]), dtype=np.float64)
        np.add.at(result, codes, values)
        return result

    def score(self, actual, predicted):
        actual, predicted = np.asarray(actual, dtype=np.float64), np.asarray(predicted, dtype=np.float64)
        if actual.shape != predicted.shape or actual.shape != (self.n, 28):
            raise ValueError('expected aligned series-by-28 predictions')
        if not np.isfinite(actual).all() or not np.isfinite(predicted).all() or (actual < 0).any() or (predicted < 0).any():
            raise ValueError('invalid values')
        result = []
        for codes, count, scale, weights in self.levels:
            error = self.aggregate(actual - predicted, codes, count)
            rmsse = np.sqrt(np.divide((error ** 2).mean(axis=1), scale,
                                     out=np.zeros(count), where=scale > 0))
            result.append(float(weights @ rmsse))
        volume = actual.sum()
        return {'scope_wrmsse': float(np.mean(result)), 'by_level': result,
                'wape': float(np.abs(actual - predicted).sum() / volume) if volume else None,
                'bias': float((predicted - actual).sum() / volume) if volume else None,
                'mae': float(np.abs(actual - predicted).mean())}

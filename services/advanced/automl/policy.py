"""Selection accepts validation evidence only; replay is deliberately absent."""
import math


def select(candidates, direction, tolerance=.01):
    if direction not in ('minimize', 'maximize') or not 0 <= tolerance <= 1:
        raise ValueError('Invalid selection policy')
    valid = [c for c in candidates if c['state'] == 'COMPLETE']
    if not valid or len({c['id'] for c in candidates}) != len(candidates):
        raise ValueError('Empty or duplicate candidates')
    for c in valid:
        if c['split'] != 'validation' or not math.isfinite(c['value']) or not math.isfinite(c['cost_seconds']) or c['cost_seconds'] < 0:
            raise ValueError('Invalid validation evidence')
    quality = lambda c: c['value'] if direction == 'minimize' else -c['value']
    best = min(valid, key=lambda c: (quality(c), c['id']))
    slack = abs(best['value']) * tolerance
    eligible = [c for c in valid if quality(c) <= quality(best) + slack + 1e-12]
    efficient = min(eligible, key=lambda c: (c['cost_seconds'], quality(c), c['id']))
    frontier = [c['id'] for c in valid if not any(
        quality(o) <= quality(c) and o['cost_seconds'] <= c['cost_seconds'] and
        (quality(o) < quality(c) or o['cost_seconds'] < c['cost_seconds']) for o in valid)]
    return dict(accuracy=best['id'], efficient=efficient['id'], eligible=[c['id'] for c in eligible],
                pareto=frontier, direction=direction, relative_tolerance=tolerance,
                best_validation_value=best['value'], split='validation')

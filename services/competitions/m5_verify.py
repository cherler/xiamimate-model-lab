"""Recompute metrics from saved forecasts; never reopen reserved target CSV columns."""
import json
from pathlib import Path
import numpy as np
from .m5_data import ROOT, digest, load, revenue_at
from .m5_metrics import WRMSSE


def verify(run):
    checksums = json.loads((run / 'checksums.json').read_text())
    for relative, expected in checksums.items():
        path = (run / relative).resolve()
        if not path.is_relative_to(run.resolve()) or digest(path) != expected:
            raise ValueError(f'run file changed: {relative}')
    report = json.loads((run / 'report.json').read_text())
    config = report['config']
    # At most d_1913, including only historical/development labels.
    metadata, history, _, prices = load(config['store'], config['sealed_origin'])
    for fold in report['folds'] + ([report['final']] if 'final' in report else []):
        origin = fold['origin']
        evaluator = WRMSSE(metadata, history[:, :origin], revenue_at(history, prices, origin))
        if origin == config['sealed_origin']:
            rows = np.load(run / 'reserved-predictions.npz')
            actual = np.load(run / 'reserved-actual.npz')['actual']
        else:
            rows = np.load(run / f'predictions-{origin}.npz')
            actual = rows['actual']
        for name, metrics in fold['models'].items():
            fresh = evaluator.score(actual, rows[name])
            for key in ['scope_wrmsse', 'wape', 'mae', 'bias', 'by_level']:
                if not np.allclose(metrics[key], fresh[key], rtol=1e-10, atol=1e-10):
                    raise ValueError(f'metric mismatch: {origin}/{name}/{key}')
    scores = {name: float(np.mean([f['models'][name]['scope_wrmsse'] for f in report['folds']])) for name in config['models']}
    selection = json.loads((run / 'selection.json').read_text())
    if selection['scores'] != scores or selection['winner'] != min(scores, key=scores.get):
        raise ValueError('selection does not match development')
    print(f'Verified {run.name}: saved forecasts, 12 hierarchy levels and development-only selection.', flush=True)


if __name__ == '__main__':
    pointer = json.loads((ROOT / 'artifacts/competition-m5.json').read_text())
    run = ROOT / 'artifacts/competition-runs' / pointer['run_id']
    if digest(run / 'report.json') != pointer['report_sha256']:
        raise ValueError('pointer/report mismatch')
    verify(run)

"""Replay frozen weights for sample explanations; never train or mutate source runs."""
import os
os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')
import gzip
import json
import pickle
import sys
import numpy as np
from common import ROOT, sha, write
from verify import verify_run


def sources():
    runs = {}
    for kind in ('ranking', 'graph', 'tft'):
        p = json.loads((ROOT / f'artifacts/advanced-{kind}.json').read_text())
        run = ROOT / 'artifacts/advanced-runs' / p['run_id']
        if sha(run / 'report.json') != p['report_sha256']:
            raise ValueError('Source pointer mismatch')
        verify_run(run)
        runs[kind] = run
    return runs


def contribution_record(values, contributions, score):
    values = np.asarray(values, dtype=float)
    contributions = np.asarray(contributions, dtype=float)
    np.testing.assert_allclose(contributions.sum(), score, atol=1e-7)
    if not np.isfinite(contributions).all():
        raise ValueError('Nonfinite contribution')
    return {'values': values.tolist(), 'contributions': contributions[:-1].tolist(),
            'base': float(contributions[-1]), 'score': float(score),
            'reconstruction_error': float(abs(contributions.sum() - score))}


def trees(runs):
    from lightgbm import Booster
    from ranking import FEATURES, GROUPS
    parent = runs['ranking']
    samples = json.loads((parent / 'samples.json').read_text())
    result = {'recommendation': [], 'forecast': []}
    models = {k: Booster(model_file=str(parent / f'{k}.txt')) for k in GROUPS}
    for origin in sorted({s['origin'] for s in samples}):
        with gzip.open(parent / f'snapshot-{origin}.pkl.gz', 'rb') as f:
            bundle = pickle.load(f)  # locally produced and checksum-verified above
        queries = {q['customer']: q for q in bundle['queries']}
        for sample in (s for s in samples if s['origin'] == origin):
            q = queries[sample['customer']]
            ids = np.array(bundle['snapshot']['items'])[q['ids']]
            record = {'origin': origin, 'customer': sample['customer'], 'models': {}}
            for name, n in GROUPS.items():
                x = q['features'][:, :n]
                score = models[name].predict(x, num_threads=2)
                contrib = models[name].predict(x, pred_contrib=True, num_threads=2)
                order = np.argsort(-score, kind='stable')
                if ids[order[:10]].tolist() != sample['models'][name]['ranked']:
                    raise ValueError('Ranking replay differs')
                record['models'][name] = {'features': FEATURES[:n], 'candidate_count': len(ids),
                    'items': {str(ids[i]): {**contribution_record(x[i], contrib[i], score[i]), 'rank': int(rank + 1)}
                              for rank, i in enumerate(order[:11])}}
            result['recommendation'].append(record)
    run = runs['tft']
    x = np.load(run / 'tree-inputs.npz')['evaluation']
    model = Booster(model_file=str(run / 'lightgbm.txt'))
    scores = model.predict(x, num_threads=2)
    contributions = model.predict(x, pred_contrib=True, num_threads=2)
    report = json.loads((run / 'report.json').read_text())
    names = ['log_lag1', 'log_lag7', 'log_lag14', 'log_lag28', 'log_mean7', 'log_mean28', 'log_mean56',
             'log_std28', 'log_max28', 'log_weekday_median', 'log_weekday_mean', 'horizon_scaled',
             'zero_rate28', 'weekday_sin', 'weekday_cos', 'month_sin', 'month_cos', 'log_price',
             *[f'item_{i}' for i in report['items']]]
    samples = json.loads((run / 'samples.json').read_text())
    for sample in samples:
        origin_index = [w['origin'] for w in report['windows']].index(sample['origin'])
        item_index = report['items'].index(sample['item'])
        start = (origin_index * len(report['items']) + item_index) * 7
        days = []
        for day in range(7):
            i = start + day
            np.testing.assert_allclose(max(0, scores[i]), sample['predictions']['lightgbm'][day], atol=1e-7)
            days.append(contribution_record(x[i], contributions[i], scores[i]))
        result['forecast'].append({'origin': sample['origin'], 'item': sample['item'], 'features': names, 'days': days})
    return result


def main(kind):
    runs = sources()
    payload = {'schema': 1, 'kind': kind, 'runs': {k: p.name for k, p in runs.items()},
               'reports': {k: sha(p / 'report.json') for k, p in runs.items()},
               'generator_sha256': sha(__file__), 'method': 'frozen_weight_replay',
               'data': {'trees': trees}[kind](runs)}
    write(ROOT / f'artifacts/advanced-explanation-{kind}.json', payload)
    print('Verified and explained', kind)


if __name__ == '__main__':
    main(sys.argv[1])

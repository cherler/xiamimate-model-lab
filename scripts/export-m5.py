"""Export verified saved M5 results for explicitly requested local frontend preview.

Never trains or reads reserved labels from raw CSV. Public builds exclude this bundle.
"""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.competitions.m5_data import ROOT, digest, load, write
from services.competitions.m5_verify import verify
from services.competitions.coverage_export import read_coverage

pointer = json.loads((ROOT / 'artifacts/competition-m5.json').read_text())
run = ROOT / 'artifacts/competition-runs' / pointer['run_id']
if not run.resolve().is_relative_to((ROOT / 'artifacts/competition-runs').resolve()):
    raise ValueError('invalid run path')
if digest(run / 'report.json') != pointer['report_sha256']:
    raise ValueError('report pointer mismatch')
verify(run)
report = json.loads((run / 'report.json').read_text())
if report['status'] != 'complete_reserved_window_consumed' or report['config']['protocol'] != 'm5-local-core-v1':
    raise ValueError('only the verified complete M5 pilot is supported')
metadata, history, calendar, _ = load('CA_1', 1913)
metadata = metadata.reset_index(drop=True)
coverage, coverage_sha = read_coverage('m5', run)
version = hashlib.sha256((pointer['report_sha256'] + coverage_sha + digest(__file__)).encode()).hexdigest()[:16]
output = ROOT / 'apps/web/m5-results'
folder = output / version
folder.mkdir(parents=True, exist_ok=True)
resources = {}


def save(key, data):
    path = folder / f'{key}.json'
    write(path, data)
    resources[key] = {'path': f'{version}/{key}.json', 'sha256': digest(path)}


catalog = [{'id': row.id, 'item': row.item_id, 'category': row.cat_id,
            'department': row.dept_id, 'shard': i // 100} for i, row in metadata.iterrows()]
save('catalog', catalog)
overview = {'run_id': report['run_id'], 'scope': {'store': 'CA_1', 'series': len(metadata), 'horizon': 28},
            'mode': 'local_research_preview', 'public_export_allowed': False,
            'selection': {'winner': report['selection']['winner'], 'scores': report['selection']['scores'],
                          'frozen_at': report['selection']['frozen_at']},
            'training': {'features': 42, 'window_days': 1095, 'rounds': 1000,
                         'params': report['config']['params']}, 'windows': []}
for fold in report['folds'] + [report['final']]:
    origin = fold['origin']
    final = origin == 1913
    rows = np.load(run / ('reserved-predictions.npz' if final else f'predictions-{origin}.npz'))
    actual = np.load(run / 'reserved-actual.npz')['actual'] if final else rows['actual']
    predictions = {name: rows[name] for name in fold['models']}
    if actual.shape != (len(metadata), 28) or any(p.shape != actual.shape for p in predictions.values()):
        raise ValueError('cohort/horizon mismatch')
    past = history[:, origin - 28:origin]
    dates = calendar.date.iloc[origin:origin + 28].tolist()
    history_dates = calendar.date.iloc[origin - 28:origin].tolist()
    window = {'origin': origin, 'kind': 'reserved_consumed' if final else 'development',
              'dates': dates, 'history_dates': history_dates, 'models': fold['models'],
              'cost': fold['cost'], 'groups': {}}
    for group in ['store', *sorted(metadata.cat_id.unique())]:
        mask = np.ones(len(metadata), dtype=bool) if group == 'store' else metadata.cat_id.eq(group).to_numpy()
        window['groups'][group] = {'series': int(mask.sum()), 'history': past[mask].sum(axis=0).astype(float).tolist(),
                                  'actual': actual[mask].sum(axis=0).astype(float).tolist(),
                                  'predictions': {name: p[mask].sum(axis=0).tolist() for name, p in predictions.items()}}
    overview['windows'].append(window)
    for start in range(0, len(metadata), 100):
        bundle = {}
        for i in range(start, min(start + 100, len(metadata))):
            bundle[catalog[i]['id']] = {'series': 1, 'history': past[i].astype(float).tolist(),
                                         'actual': actual[i].astype(float).tolist(),
                                         'predictions': {name: p[i].tolist() for name, p in predictions.items()}}
        save(f'items-{origin}-{start // 100}', {'run_id': report['run_id'], 'origin': origin, 'items': bundle})
save('overview', overview)
if coverage: save('coverage', coverage)
manifest = {'schema': 1, 'version': version, 'run_id': report['run_id'],
            'mode': 'local_research_preview', 'public_export_allowed': False,
            'source_report_sha256': pointer['report_sha256'], 'resources': resources}
# Switch the pointer only after every immutable resource is present.
temporary = output / 'manifest.json.tmp'
write(temporary, manifest)
temporary.replace(output / 'manifest.json')
print(f'M5 local preview {version}: {len(catalog)} items, 3 windows, 4 models. Excluded from public build.')

"""Develop -> rehearse -> freeze -> single final test. Never changes UCI latest."""
from __future__ import annotations
import os
for key in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS']:
    os.environ[key] = '2'
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import shutil
import sys
import time

import numpy as np
import pandas as pd

from ml.evaluation_protocol import CONFIG, WORKSPACE, digest, read_json, write_json, verify_workspace, load_development, open_final_test
from ml.tafeng import fit_recommendation, recommendation_records, summarize_ranking, select_ranking, paired_ndcg, weekly_predictions, forecast_specs, select_forecast, FEATURES

ROOT = Path(__file__).resolve().parents[1]
RECIPE = 'services/configs/tafeng-development-v1.json'
SOURCE_FILES = [CONFIG, RECIPE, 'services/train_tafeng.py', 'services/ml/tafeng.py',
                'services/ml/evaluation_protocol.py', 'services/ml/core.py', 'services/ml/recommenders.py',
                'services/ml/personalized.py', 'services/ml/forecasting.py', 'services/ml/forecasting_v2.py',
                'services/ml/statistical_worker.py', 'scripts/verify-tafeng.py', 'uv.lock', 'pyproject.toml']


def seal_outputs(out):
    write_json(out/'checksums.json', {str(p.relative_to(out)): digest(p) for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'checksums.json'})


def check_outputs(out):
    for name, sha in read_json(out/'checksums.json').items():
        if digest(out/name) != sha:
            raise ValueError(f'Run artifact changed: {name}')


def selected_specs(decisions, recipe):
    result = {}
    for task in ['repurchase', 'discovery']:
        keep = {decisions[task]['selected_model'], decisions[task]['baseline']}
        result[task] = {name: p for name, p in recipe['recommendation_models'][task].items() if p['baseline'] or name in keep}
    weekly = forecast_specs(recipe)
    name = decisions['weekly_sales']['selected_model']
    return result, {name: weekly[name]} if name in weekly else {}


def execute(data, phase, out, config, recipe, decisions=None):
    started = time.perf_counter()
    out.mkdir(parents=True, exist_ok=False)
    final = phase == 'final'
    origin = config['recommendation']['test_origin' if final else 'development_origin']
    end = config['time']['test' if final else 'development'][1]
    specs, f_specs = (selected_specs(decisions, recipe) if decisions else (recipe['recommendation_models'], forecast_specs(recipe)))
    print(f'{phase}: fitting recommendation from records strictly before {origin}', flush=True)
    model = fit_recommendation(data[data.date < origin], origin, recipe, out/'recommendation-model')
    records = recommendation_records(model, data, origin, end, specs, out)
    rec_summaries = {task: {name: summarize_ranking(rows, len(model['items']), task) for name, rows in models.items()} for task, models in records.items()}
    items = read_json(ROOT/WORKSPACE/'forecast-items.json')['items']
    origins = config['forecast']['test_origins' if final else 'development_origins']
    frame, weekly, fallbacks = weekly_predictions(data, items, origins, recipe, f_specs, out)
    report = {'case': 'Ta Feng', 'phase': phase, 'run_id': out.name, 'protocol_sha256': digest(ROOT/CONFIG),
              'origin': origin, 'end_exclusive': end, 'recommendation': rec_summaries,
              'weekly': weekly, 'forecast_items': items, 'forecast_rows': len(frame), 'statistical_fallbacks': fallbacks,
              'environment': {'python': platform.python_version(), 'machine': platform.machine(), 'threads': 2, 'device': 'CPU'},
              'limitations': ['One recommendation month and four weekly origins; no multi-season claim.',
                             'Offline conditional-on-return recommendation, not conversion or revenue.',
                             'Separate dataset and shopping-day target; not comparable to UCI scores as improvement.',
                             'Positive recorded sales, not unconstrained demand. No prediction intervals.']}
    if decisions is None:
        decisions = {}
        for task, summaries in rec_summaries.items():
            selected, baseline = select_ranking(summaries, specs[task])
            kind = specs[task][selected]['kind']
            feature_sets = {
                'frequency': ['historical purchase-day counts'], 'recent': ['age of last purchase'],
                'decay90': ['purchase-day counts with 90-day exponential decay'],
                'decay30': ['purchase-day counts with 30-day exponential decay'],
                'interval_blend': ['median historical interpurchase gap', 'age of last purchase', '90-day decayed purchase counts'],
                'als_decay': ['binary train-only ALS interactions', '90-day decayed purchase counts'],
                'popular': ['distinct historical buyers per item'], 'itemcf': ['binary train-only co-purchases'],
                'als': ['binary train-only ALS interactions'], 'recent_popularity': ['distinct buyers within past 30 days'],
                'category': ['train-only item category', 'category purchase-day affinity', 'historical buyer popularity'],
                'als_itemcf': ['binary train-only ALS interactions', 'binary train-only co-purchases'],
                'als_category': ['binary train-only ALS interactions', 'train-only item category', 'category purchase-day affinity', 'historical buyer popularity']}
            decisions[task] = {'selected_model': selected, 'baseline': baseline,
                'selected_parameters': specs[task][selected],
                'features': feature_sets[kind],
                'selection_note': 'Highest development mean NDCG including empty task-target customers; exact ties prefer simplicity.'}
        selected, baseline, qualified = select_forecast(weekly, f_specs)
        decisions['weekly_sales'] = {'selected_model': selected, 'baseline': baseline, 'selected_parameters': f_specs.get(selected, {}),
                                    'features': ['past 56+ days sales; four completed inner-validation weeks'] if selected.startswith('history_') else FEATURES+['fixed_product_one_hot'], 'qualifying_learned_candidate': qualified}
    report['decisions'] = decisions
    report['comparisons'] = {}
    for task in ['repurchase', 'discovery']:
        decision = decisions[task]
        interval = paired_ndcg(records[task][decision['selected_model']], records[task][decision['baseline']])
        report['comparisons'][task] = {'paired_ndcg': interval,
            'gain_screen_passed': interval['difference'] >= .01 and interval['low'] > 0,
            'evidence': 'final holdout' if final else 'development only; selection optimism applies'}
    d = decisions['weekly_sales']; chosen = weekly[d['selected_model']]; base = weekly[d['baseline']]
    gain = 1-chosen['metrics']['wape']/base['metrics']['wape'] if base['metrics']['wape'] else None
    wins = sum(c['wape'] < b['wape'] for c, b in zip(chosen['windows'], base['windows']))
    report['comparisons']['weekly_sales'] = {'relative_wape_gain': gain, 'winning_windows': wins,
        'absolute_bias': abs(chosen['metrics']['bias']),
        'gain_screen_passed': gain is not None and gain >= .10 and abs(chosen['metrics']['bias']) <= .20 and wins >= 3,
        'evidence': 'final holdout' if final else 'development only; selection optimism applies'}
    report['duration_seconds'] = time.perf_counter()-started
    write_json(out/'report.json', report)
    write_json(out/'recipe.json', recipe)
    source_dir = out/'source'; source_dir.mkdir()
    for relative in SOURCE_FILES:
        target = source_dir/relative; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT/relative, target)
    seal_outputs(out)
    print(f'{phase} complete: {out.name}', flush=True)
    return report


def resolve_run(value):
    path = (ROOT/'artifacts/tafeng-runs'/value).resolve()
    if path.parent != (ROOT/'artifacts/tafeng-runs').resolve():
        raise ValueError('Expected a Ta Feng run ID')
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['develop', 'rehearse', 'release', 'final'])
    parser.add_argument('--development')
    parser.add_argument('--rehearsal')
    args = parser.parse_args()
    verify_workspace(ROOT)
    config, recipe = read_json(ROOT/CONFIG), read_json(ROOT/RECIPE)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    data = load_development(ROOT)
    if args.mode == 'develop':
        if (ROOT/WORKSPACE/'final-test-access.json').exists():
            raise ValueError('Final test already opened; further development must be marked contaminated in a new workflow')
        execute(data, 'development', ROOT/'artifacts/tafeng-runs'/f'development-{stamp}', config, recipe)
        return
    if not args.development:
        raise ValueError('--development run ID is required')
    dev = resolve_run(args.development); check_outputs(dev)
    development = read_json(dev/'report.json')
    if development['phase'] != 'development':
        raise ValueError('Not a development run')
    for relative in SOURCE_FILES:
        if digest(dev/'source'/relative) != digest(ROOT/relative):
            raise ValueError(f'Source changed after development; rerun development before release: {relative}')
    decisions = development['decisions']
    if args.mode == 'rehearse':
        report = execute(data, 'rehearsal', ROOT/'artifacts/tafeng-runs'/f'rehearsal-{stamp}', config, recipe, decisions)
        for task in ['repurchase', 'discovery']:
            for name, result in report['recommendation'][task].items():
                if result != development['recommendation'][task][name]:
                    raise ValueError('Recommendation development replay differs')
        for name, result in report['weekly'].items():
            if not np.isclose(result['metrics']['wape'], development['weekly'][name]['metrics']['wape'], rtol=1e-10):
                raise ValueError('Weekly development replay differs')
        print('Selected-model development rehearsal reproduced all metrics; no final test access.', flush=True)
        return
    release_path = dev/'release.json'
    if args.mode == 'release':
        if not args.rehearsal:
            raise ValueError('--rehearsal run ID is required')
        rehearsal = resolve_run(args.rehearsal); check_outputs(rehearsal)
        replay = read_json(rehearsal/'report.json')
        if replay['phase'] != 'rehearsal' or replay['decisions'] != decisions:
            raise ValueError('Rehearsal does not match selected development decisions')
        for relative in SOURCE_FILES:
            if digest(rehearsal/'source'/relative) != digest(ROOT/relative):
                raise ValueError('Rehearsal source differs')
        # Recheck equality here, not merely the successful terminal message.
        for task in ['repurchase', 'discovery']:
            for name, result in replay['recommendation'][task].items():
                if result != development['recommendation'][task][name]:
                    raise ValueError('Rehearsal recommendation metrics differ')
        for name, result in replay['weekly'].items():
            if not np.isclose(result['metrics']['wape'], development['weekly'][name]['metrics']['wape'], rtol=1e-10):
                raise ValueError('Rehearsal weekly metrics differ')
        files = {p: digest(ROOT/p) for p in SOURCE_FILES}
        for path in [dev/'report.json', dev/'checksums.json', rehearsal/'report.json', rehearsal/'checksums.json']:
            files[str(path.relative_to(ROOT))] = digest(path)
        tasks = {task: {**decision, 'development_result_path': str((dev/'report.json').relative_to(ROOT))} for task, decision in decisions.items()}
        release = {'protocol_sha256': digest(ROOT/CONFIG), 'manifest_sha256': digest(ROOT/WORKSPACE/'manifest.json'),
                   'files': files, 'tasks': tasks, 'created_at': datetime.now(timezone.utc).isoformat(),
                   'recipe': recipe, 'development': dev.name, 'rehearsal': rehearsal.name}
        with release_path.open('x') as stream:
            json.dump(release, stream, indent=2, ensure_ascii=False, allow_nan=False)
        print(f'Release frozen: {release_path}; final test is still sealed.', flush=True)
        return
    release = read_json(release_path)
    if release['development'] != dev.name or release['recipe'] != recipe:
        raise ValueError('Release does not match current development')
    # All dependencies and release checks precede the one and only test access.
    final_data = open_final_test(ROOT, release_path)
    combined = pd.concat([data, final_data], ignore_index=True)
    out = ROOT/'artifacts/tafeng-runs'/f'final-{stamp}'
    try:
        execute(combined, 'final', out, config, recipe, decisions)
        write_json(ROOT/WORKSPACE/'final-evaluation-outcome.json', {'status': 'complete', 'run_id': out.name,
                    'report_sha256': digest(out/'report.json'), 'release_sha256': digest(release_path)})
    except Exception as error:
        write_json(ROOT/WORKSPACE/'final-evaluation-outcome.json', {'status': 'failed_consumed', 'run_id': out.name, 'error': f'{type(error).__name__}: {error}'})
        raise


if __name__ == '__main__':
    main()

"""Prepare and freeze metadata/splits; never fit models or expose test outcomes."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys
import zipfile

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services'))
from ml.evaluation_protocol import CONFIG, WORKSPACE, digest, read_json, write_json, verify_workspace


def audit_prior_runs():
    records = []
    for run in sorted((ROOT / 'artifacts/runs').iterdir()):
        if not run.is_dir():
            continue
        report_path = run / 'report.json'
        if not report_path.exists():
            records.append({'run_id': run.name, 'status': 'incomplete; not evidence of an unused period'})
            continue
        report = read_json(report_path)
        config = report['config']
        rec = report.get('recommendation', {}).get('windows', [])
        if not rec:
            rec = [{'origin': config['validation_start'], 'end_exclusive': config['validation_end']},
                   {'origin': config['test_start'], 'end_exclusive': config['test_end']}]
        daily = [{'origin': w['origin'], 'end_inclusive': w.get('end', str((pd.Timestamp(w['origin']) + pd.Timedelta(days=27)).date()))}
                 for w in report.get('forecast', {}).get('windows', [])]
        records.append({'run_id': run.name, 'report_sha256': digest(report_path),
                        'recommendation_windows': [{'origin': w['origin'], 'end_exclusive': w['end_exclusive']} for w in rec],
                        'daily_windows': daily, 'weekly_origins': report.get('weekly', {}).get('origins', []),
                        'current_classification': 'exposed_development; earlier test labels reused in later rounds'})
    audit = read_json(ROOT / 'data/processed/audit.json')
    return {'dataset': 'UCI Online Retail II', 'source_sha256': audit['input_sha256'],
            'date_min': audit['date_min'], 'date_max': audit['date_max'],
            'conservative_shared_exposure_end_exclusive': '2011-12-01',
            'last_date_excluded_as_possibly_partial': '2011-12-09',
            'remaining_full_calendar_days': 8, 'remaining_nonoverlapping_7day_windows': 1,
            'remaining_full_calendar_months': 0,
            'decision': 'Keep as development case. December is insufficient for the planned final test; do not retroactively carve an earlier independent test.',
            'audit_scope': 'Local saved runs and source configuration only; cannot prove no one has viewed the public data elsewhere.',
            'runs': records}


def prepare():
    config = read_json(ROOT / CONFIG)
    work = ROOT / WORKSPACE
    if (work / 'manifest.json').exists():
        manifest = verify_workspace(ROOT)
        print(f'Existing freeze verified: {manifest["protocol_id"]}; test remains unopened by this command.')
        return
    if work.exists() and any(work.iterdir()):
        raise RuntimeError('Partial preparation exists; inspect it before creating a different frozen workspace')
    archive = ROOT / 'data/raw/ta-feng-v1/dataset.zip'
    if digest(archive) != config['source']['archive_sha256']:
        raise ValueError('Unexpected Ta Feng source version')
    metadata_path = ROOT / 'data/raw/ta-feng-v1/kaggle-metadata.json'
    metadata = next(d for d in read_json(metadata_path) if d['ref'] == 'chiranjivdas09/ta-feng-grocery-dataset')
    if metadata['currentVersionNumber'] != 1 or metadata['licenseName'] != 'CC0: Public Domain':
        raise ValueError('Source version/license metadata changed; review before ingestion')
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError('Corrupt source ZIP')
        with z.open(config['source']['member']) as stream:
            frame = pd.read_csv(stream, dtype=str, encoding='utf-8-sig')
    # Ignore demographics, source cost and price as model features. All business
    # inspection below is confined to the initial training portion.
    normalized = pd.DataFrame({
        'date': pd.to_datetime(frame.TRANSACTION_DT, format='%m/%d/%Y', errors='coerce'),
        'customer': frame.CUSTOMER_ID.str.strip(), 'item': frame.PRODUCT_ID.str.strip(),
        'category': frame.PRODUCT_SUBCLASS.str.strip(),
        'quantity': pd.to_numeric(frame.AMOUNT, errors='coerce')})
    price = pd.to_numeric(frame.SALES_PRICE, errors='coerce')
    invalid = normalized.date.isna() | normalized.item.isna() | normalized.item.eq('') | ~np.isfinite(normalized.quantity) | ~np.isfinite(price) | normalized.quantity.le(0) | price.le(0)
    if normalized.date.isna().any():
        raise ValueError('Invalid source date requires review before freezing')
    start = pd.Timestamp(config['time']['train'][0]); end = pd.Timestamp(config['time']['test'][1])
    if not ((normalized.date >= start) & (normalized.date < end)).all():
        raise ValueError('Source dates fall outside predeclared range')
    normalized = normalized.loc[~invalid].copy()
    normalized = normalized.sort_values(['date', 'customer', 'item'], kind='stable').reset_index(drop=True)
    split_info = {}
    for name in ('train', 'development', 'test'):
        begin, stop = config['time'][name]
        part = normalized[(normalized.date >= begin) & (normalized.date < stop)]
        expected = pd.date_range(begin, pd.Timestamp(stop) - pd.Timedelta(days=1))
        missing = expected.difference(part.date.unique())
        split_info[name] = {'start': begin, 'end_exclusive': stop, 'rows': len(part), 'calendar_days': len(expected),
                            'dates_with_records': int(part.date.nunique()), 'missing_record_dates': [str(d.date()) for d in missing]}
        if len(missing):
            raise ValueError(f'Missing whole-source dates in {name}; do not silently fabricate complete coverage')
    train = normalized[normalized.date < config['time']['train'][1]]
    eligible = train.groupby('item').agg(active_days=('date', 'nunique'), units=('quantity', 'sum')).reset_index()
    eligible = eligible[eligible.active_days >= config['forecast']['minimum_training_active_days']]
    selected = eligible.sort_values(['units', 'item'], ascending=[False, True], kind='stable').head(config['forecast']['series_count']).item.tolist()
    if len(selected) != config['forecast']['series_count']:
        raise ValueError('Insufficient train-only eligible products; protocol revision required before model development')
    work.mkdir(parents=True, exist_ok=True)
    boundary = config['time']['test'][0]
    normalized[normalized.date < boundary].to_csv(work / 'development.csv.gz', index=False, compression={'method': 'gzip', 'mtime': 0})
    normalized[normalized.date >= boundary].to_csv(work / 'sealed-test.csv.gz', index=False, compression={'method': 'gzip', 'mtime': 0})
    write_json(work / 'forecast-items.json', {'selection_end_exclusive': config['forecast']['series_selection_end_exclusive'], 'items': selected})
    readiness = {'protocol_id': config['protocol_id'], 'created_at': datetime.now(timezone.utc).isoformat(),
                 'source': config['source'], 'raw_rows': len(frame), 'retained_rows': len(normalized),
                 'removed_invalid_or_nonpositive_rows': int(invalid.sum()),
                 'identical_source_rows_retained': int(frame.duplicated().sum()),
                 'structural_splits': split_info, 'forecast_fixed_items': selected,
                 'training_eligible_products': len(eligible),
                 'target_values_inspected_for_model_selection': 'none; no models or evaluation metrics produced',
                 'test_access_scope': 'Automated parsing/cleaning, dates, counts, coverage and checksums only; no target aggregates, sample rows or error analysis exposed.',
                 'test_limitations': ['One calendar month; only four weekly origins.', 'No invoices or timestamps: use customer shopping-day baskets.', 'Missing product-day rows mean assumed zero recorded sales, not observed stock or latent demand.', 'Kaggle distributor declares CC0; original retailer authorization was not separately verified.'],
                 'uci_exposure_audit': audit_prior_runs()}
    evidence = ROOT / 'docs/evaluation/data-readiness.json'
    evidence.parent.mkdir(parents=True, exist_ok=True)
    write_json(evidence, readiness)
    tracked = [CONFIG, 'services/ml/evaluation_protocol.py', 'scripts/prepare-evaluation.py',
               'docs/evaluation/business-scenarios.md', 'docs/evaluation/evaluation-protocol.md',
               str(evidence.relative_to(ROOT)), str(archive.relative_to(ROOT)), str(metadata_path.relative_to(ROOT)),
               f'{WORKSPACE}/development.csv.gz', f'{WORKSPACE}/sealed-test.csv.gz', f'{WORKSPACE}/forecast-items.json']
    manifest = {'protocol_id': config['protocol_id'], 'created_at': readiness['created_at'], 'test_status_at_freeze': 'sealed_not_evaluated',
                'files': {relative: digest(ROOT / relative) for relative in tracked}}
    write_json(work / 'manifest.json', manifest)
    write_json(ROOT / 'docs/evaluation/protocol-lock.json', {'protocol_id': config['protocol_id'], 'manifest_sha256': digest(work / 'manifest.json'), 'files': manifest['files']})
    print('Frozen protocol prepared. No training or final evaluation performed.')
    print('Structural split sizes:', {name: info['rows'] for name, info in split_info.items()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.verify:
        manifest = verify_workspace(ROOT)
        lock = read_json(ROOT / 'docs/evaluation/protocol-lock.json')
        if digest(ROOT / WORKSPACE / 'manifest.json') != lock['manifest_sha256']:
            raise ValueError('Frozen manifest changed')
        if (ROOT / WORKSPACE / 'final-test-access.json').exists():
            print('Protocol files valid; final test has already been opened/consumed.')
        else:
            print('Protocol files valid; final test remains sealed and unscored.')
    else:
        prepare()

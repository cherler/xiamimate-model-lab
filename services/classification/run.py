"""Frozen CPU classification experiment. Development never opens the test partition."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import math
import platform
import shutil
import time
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import sklearn
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score, log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = Path(__file__).with_name('protocol.json')
RUNS = ROOT / 'artifacts/classification-runs'
POINTER = ROOT / 'artifacts/classification-latest.json'
NAMES = ['rules', 'logistic', 'lightgbm']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def read(path):
    return json.loads(path.read_text())


def source_hashes():
    return {p.name: digest(p.read_bytes()) for p in [Path(__file__), PROTOCOL]}


def grouped_split(x, seed, buckets):
    groups = np.array([digest(np.asarray(row, dtype='<f8').tobytes()) for row in x])
    values = np.array([int(digest(f'{seed}:{g}'.encode())[:16], 16) % 10000 for g in groups])
    return groups, {name: np.flatnonzero((values >= bounds[0]) & (values < bounds[1])) for name, bounds in buckets.items()}


def confusion(y, selected):
    y = np.asarray(y, dtype=int); selected = np.asarray(selected, dtype=bool)
    tp = int(np.sum((y == 1) & selected)); fp = int(np.sum((y == 0) & selected))
    fn = int(np.sum((y == 1) & ~selected)); tn = int(np.sum((y == 0) & ~selected))
    return {'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn, 'selected': tp + fp,
            'precision': tp / (tp + fp) if tp + fp else None,
            'recall': tp / (tp + fn) if tp + fn else None,
            'fpr': fp / (fp + tn) if fp + tn else None}


def calibration_bins(y, p):
    out = []
    for i in range(10):
        keep = (p >= i / 10) & ((p < (i + 1) / 10) if i < 9 else (p <= 1))
        n = int(keep.sum())
        out.append({'lower': i / 10, 'upper': (i + 1) / 10, 'n': n,
                    'mean_score': float(p[keep].mean()) if n else None,
                    'positive_rate': float(y[keep].mean()) if n else None})
    return out


def metrics(y, p):
    y = np.asarray(y); p = np.asarray(p)
    if len(y) == 0 or not np.isfinite(p).all() or ((p < 0) | (p > 1)).any():
        raise ValueError('Invalid scores')
    bins = calibration_bins(y, p)
    return {'n': len(y), 'positives': int(y.sum()), 'prevalence': float(y.mean()),
            'ap': float(average_precision_score(y, p)), 'roc_auc': float(roc_auc_score(y, p)),
            'brier': float(np.mean((p-y)**2)), 'log_loss': float(log_loss(y, p, labels=[0, 1])),
            'ece': sum(b['n'] * abs(b['mean_score']-b['positive_rate']) for b in bins if b['n']) / len(y), 'bins': bins}


def choose_threshold(y, p, max_fpr=.02):
    choices = []
    for threshold in np.r_[np.unique(p), 1.000001]:
        c = confusion(y, p >= threshold)
        if c['fpr'] is not None and c['fpr'] <= max_fpr:
            choices.append((c['recall'] or 0, c['precision'] or 0, float(threshold)))
    return max(choices)[2]


def capacity_order(p, groups, ids):
    return np.lexsort((ids, groups, -np.asarray(p)))


def logit(p):
    p = np.clip(p, 1e-6, 1-1e-6)
    return np.log(p/(1-p)).reshape(-1, 1)


def rules_score(x, features, conditions):
    return np.mean([x[:, features.index(name)] >= threshold for name, threshold in conditions.items()], axis=0)


def prepare():
    cfg = read(PROTOCOL)
    raw = ROOT / 'data/raw/spambase.zip'
    raw.parent.mkdir(parents=True, exist_ok=True)
    if not raw.exists():
        with urllib.request.urlopen(cfg['download'], timeout=60) as response:
            raw.write_bytes(response.read())
    with zipfile.ZipFile(raw) as archive:
        content = archive.read('spambase.data'); names_bytes = archive.read('spambase.names')
    if digest(content) != cfg['data_sha256']:
        raise ValueError('Source data fingerprint changed')
    features = [line.split(':')[0] for line in names_bytes.decode().splitlines() if not line.startswith('|') and ':' in line and line.split(':')[1].strip() == 'continuous.']
    if len(features) != 57:
        raise ValueError('Unexpected feature schema')
    matrix = np.loadtxt(io.BytesIO(content), delimiter=',')
    if matrix.shape != (4601, 58) or not np.isfinite(matrix).all() or not set(matrix[:, -1]).issubset({0, 1}):
        raise ValueError('Unexpected source data')
    retained = [n for n in features if n not in cfg['excluded_features']]
    x = matrix[:, [features.index(n) for n in retained]]; y = matrix[:, -1].astype(int)
    groups, splits = grouped_split(x, cfg['seed'], cfg['split']['buckets'])
    run_id = 'spambase-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    directory = RUNS / run_id; directory.mkdir(parents=True, exist_ok=False)
    for name, ids in splits.items():
        np.savez_compressed(directory / f'{name}.npz', x=x[ids], y=y[ids], ids=ids, groups=groups[ids])
    metadata = {'run_id': run_id, 'source': cfg['source'], 'download': cfg['download'],
                'zip_sha256': digest(raw.read_bytes()), 'data_sha256': digest(content), 'names_sha256': digest(names_bytes),
                'rows': len(x), 'features': retained, 'original_features': len(features),
                'unique_groups': len(set(groups)), 'split_sizes': {k: len(v) for k,v in splits.items()},
                'partition_hashes': {k: digest((directory/f'{k}.npz').read_bytes()) for k in splits},
                'protocol': cfg, 'protocol_sha256': digest(PROTOCOL.read_bytes())}
    write(directory/'metadata.json', metadata)
    shutil.copy(PROTOCOL, directory/'protocol.json')
    write(POINTER, {'run_id': run_id, 'stage': 'prepared'})
    print(json.dumps({'run_id': run_id, 'sha256': metadata['data_sha256'], 'splits': metadata['split_sizes'], 'unique_groups':metadata['unique_groups']}))


def context():
    pointer=read(POINTER); directory=RUNS/pointer['run_id']; meta=read(directory/'metadata.json')
    if meta['protocol_sha256'] != digest(PROTOCOL.read_bytes()):
        raise ValueError('Protocol changed; do not silently change a prepared run')
    return pointer,directory,meta


def partition(directory, meta, name):
    path=directory/f'{name}.npz'
    if digest(path.read_bytes()) != meta['partition_hashes'][name]:
        raise ValueError('Partition hash mismatch')
    return dict(np.load(path, allow_pickle=False))


def score_rows(part, raw, calibrated):
    return [{'id':f'mail-{int(i)+1:05d}', 'source_row':int(i)+1, 'group':str(g), 'label':int(y),
             'features':x.tolist(), 'raw_scores':{k:float(v[j]) for k,v in raw.items()},
             'scores':{k:float(v[j]) for k,v in calibrated.items()}}
            for j,(i,g,y,x) in enumerate(zip(part['ids'],part['groups'],part['y'],part['x']))]


def predict(bundle, part):
    x=part['x']; cfg=bundle['protocol']
    raw={'rules':rules_score(x,bundle['features'],cfg['models']['rules'])}
    for name in ['logistic','lightgbm']:
        raw[name]=bundle['models'][name].predict_proba(x)[:,1]
    calibrated={name:bundle['calibrators'][name].predict_proba(logit(raw[name]))[:,1] for name in NAMES}
    return raw,calibrated


def develop():
    pointer,directory,meta=context()
    if pointer['stage']!='prepared': raise ValueError('Development already completed')
    start=time.perf_counter(); cfg=meta['protocol']; features=meta['features']
    train=partition(directory,meta,'train'); cal=partition(directory,meta,'calibration'); valid=partition(directory,meta,'validation')
    models={
      'logistic':make_pipeline(SimpleImputer(strategy='median'),FunctionTransformer(np.log1p),StandardScaler(),LogisticRegression(**cfg['models']['logistic'],random_state=cfg['seed'])),
      'lightgbm':make_pipeline(SimpleImputer(strategy='median'),lgb.LGBMClassifier(**cfg['models']['lightgbm'],random_state=cfg['seed']))}
    timings={};calibrators={}
    for name in NAMES:
        tick=time.perf_counter()
        if name=='rules': raw=rules_score(cal['x'],features,cfg['models']['rules'])
        else:
            models[name].fit(train['x'],train['y']); raw=models[name].predict_proba(cal['x'])[:,1]
        calibrators[name]=LogisticRegression(C=1e6,solver='lbfgs',max_iter=1000).fit(logit(raw),cal['y'])
        timings[name]=time.perf_counter()-tick
    bundle={'models':models,'calibrators':calibrators,'features':features,'protocol':cfg}
    joblib.dump(bundle,directory/'models.joblib')
    raw,p=predict(bundle,valid)
    results={name:{'raw':metrics(valid['y'],raw[name]),'calibrated':metrics(valid['y'],p[name])} for name in NAMES}
    thresholds={name:choose_threshold(valid['y'],p[name]) for name in NAMES}
    for name in NAMES: results[name]['policy']=confusion(valid['y'],p[name]>=thresholds[name])
    selected=sorted(NAMES,key=lambda name:(-results[name]['calibrated']['ap'],name))[0]
    feature_summary=[{'name':name,'median':float(np.median(train['x'][:,i])), 'p95':float(np.quantile(train['x'][:,i],.95)),
                      'logistic_coefficient':float(models['logistic'][-1].coef_[0,i]),
                      'lightgbm_gain':float(models['lightgbm'][-1].booster_.feature_importance(importance_type='gain')[i])} for i,name in enumerate(features)]
    report={**meta,'evidence':'one-time grouped random holdout; retrospective UI policies',
            'validation':results,'thresholds':thresholds,'selected_model':selected,'training_seconds':timings,
            'development_seconds':time.perf_counter()-start,'feature_summary':feature_summary,
            'training_rows':len(train['y']),'calibration_rows':len(cal['y']), 'sources':source_hashes(),
            'environment':{'python':platform.python_version(),'numpy':np.__version__,'sklearn':sklearn.__version__,'lightgbm':lgb.__version__},
            'model_sha256':digest((directory/'models.joblib').read_bytes())}
    write(directory/'validation-rows.json',score_rows(valid,raw,p))
    report['row_hashes']={'validation':digest((directory/'validation-rows.json').read_bytes())}
    write(directory/'development.json',report)
    shutil.copy(Path(__file__),directory/'source.py')
    write(POINTER,{'run_id':meta['run_id'],'stage':'frozen'})
    print(json.dumps({'selected':selected,'thresholds':thresholds,'validation_ap':{k:results[k]['calibrated']['ap'] for k in NAMES},'seconds':report['development_seconds']}))


def final():
    pointer,directory,meta=context()
    if pointer['stage']!='frozen':raise ValueError('A frozen development run is required')
    report=read(directory/'development.json')
    if report['sources']!=source_hashes() or report['model_sha256']!=digest((directory/'models.joblib').read_bytes()):
        raise ValueError('Frozen code/model changed')
    ledger=RUNS/f"test-access-{meta['data_sha256']}.json"
    # Exclusive creation precedes access. A failed final run is not silently retried.
    with ledger.open('x') as stream:
        json.dump({'run_id':meta['run_id'],'development_sha256':digest((directory/'development.json').read_bytes()),
                   'started_at':datetime.now(timezone.utc).isoformat(),'status':'access_started'},stream)
    test=partition(directory,meta,'test')
    bundle=joblib.load(directory/'models.joblib');raw,p=predict(bundle,test)
    report['test']={name:{'raw':metrics(test['y'],raw[name]),'calibrated':metrics(test['y'],p[name]),
                         'policy':confusion(test['y'],p[name]>=report['thresholds'][name])} for name in NAMES}
    report['test_access']=read(ledger);report['test_access']['status']='completed'
    write(directory/'test-rows.json',score_rows(test,raw,p))
    report['row_hashes']['test']=digest((directory/'test-rows.json').read_bytes())
    write(directory/'report.json',report)
    write(ledger,{**report['test_access'],'report_sha256':digest((directory/'report.json').read_bytes())})
    write(POINTER,{'run_id':meta['run_id'],'stage':'complete','report_sha256':digest((directory/'report.json').read_bytes())})
    print(json.dumps({name:report['test'][name] for name in NAMES}))


def assert_close(actual,expected):
    if isinstance(actual,dict):
        if set(actual)!=set(expected):raise ValueError('Metric schema mismatch')
        for key in actual:assert_close(actual[key],expected[key])
    elif isinstance(actual,list):
        if len(actual)!=len(expected):raise ValueError('Metric length mismatch')
        for a,b in zip(actual,expected):assert_close(a,b)
    elif isinstance(actual,(int,float)):
        if not isinstance(expected,(int,float)) or not math.isclose(actual,expected,rel_tol=1e-10,abs_tol=1e-10):raise ValueError('Metric mismatch')
    elif actual!=expected:raise ValueError('Metric value mismatch')


def export():
    pointer,directory,meta=context()
    if pointer['stage']!='complete':raise ValueError('No completed final report')
    report=read(directory/'report.json')
    if digest((directory/'report.json').read_bytes())!=pointer['report_sha256']:raise ValueError('Report hash mismatch')
    ledger=read(RUNS/f"test-access-{meta['data_sha256']}.json")
    if ledger['run_id']!=meta['run_id'] or ledger['report_sha256']!=pointer['report_sha256']:raise ValueError('Test ledger mismatch')
    payload={'run_id':meta['run_id'],'report':report,'rows':{}}
    for split in ['validation','test']:
        if digest((directory/f'{split}-rows.json').read_bytes())!=report['row_hashes'][split]:raise ValueError('Scored rows hash mismatch')
        rows=read(directory/f'{split}-rows.json');y=np.array([r['label'] for r in rows])
        for name in NAMES:
            for key,source in [('raw','raw_scores'),('calibrated','scores')]:
                p=np.array([r[source][name] for r in rows]);assert_close(metrics(y,p),report[split][name][key])
            p=np.array([r['scores'][name] for r in rows]);assert_close(confusion(y,p>=report['thresholds'][name]),report[split][name]['policy'])
        payload['rows'][split]=rows
    if set(r['group'] for r in payload['rows']['validation']) & set(r['group'] for r in payload['rows']['test']):raise ValueError('Overlapping groups')
    out=ROOT/'apps/web/classification-results';body=json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    sha=digest(body);name=f'{sha[:16]}/case.json';(out/sha[:16]).mkdir(parents=True,exist_ok=True);(out/name).write_bytes(body)
    write(out/'manifest.json',{'schema_version':1,'run_id':meta['run_id'],'path':name,'sha256':sha,'license':'CC BY 4.0'})
    print(json.dumps({'run_id':meta['run_id'],'export_sha256':sha,'bytes':len(body)}))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['prepare','develop','final','export'])
    globals()[parser.parse_args().command]()

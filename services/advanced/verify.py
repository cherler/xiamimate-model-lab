"""Verify saved advanced artifacts without rerunning training or changing reports."""
import json
from pathlib import Path
import sys
import numpy as np
from common import ROOT,sha,rank_metrics,forecasts_metrics

def verify_run(run):
    checks=json.loads((run/'checksums.json').read_text())
    for name,digest in checks.items():
        p=(run/name).resolve()
        if not p.is_relative_to(run.resolve()) or sha(p)!=digest:raise ValueError(f'Corrupt artifact: {name}')
    report=json.loads((run/'report.json').read_text())
    if report['run_id']!=run.name:raise ValueError('Run ID mismatch')
    return report

def verify_ranking(run):
    r=verify_run(run)
    for w in r['windows']:
        rows=json.loads((run/f"predictions-{w['origin']}.json").read_text())
        for name,records in rows.items():
            for row in records:
                actual=rank_metrics(row['ranked'],set(row['target']))
                for k,v in actual.items():np.testing.assert_allclose(row[k],v,atol=1e-12)
                assert row['recall']<=row['candidate_recall']+1e-12
                assert len(row['ranked'])==len(set(row['ranked']))
            for k in ['recall','ndcg','hit_rate','candidate_recall']:
                np.testing.assert_allclose(np.mean([row[k] for row in records]),w['models'][name][k],atol=1e-12)
    return r
def verify_tft(run):
    r=verify_run(run);rows=json.loads((run/'predictions.json').read_text())
    if len(rows)!=r['rows']:raise ValueError('Forecast row count mismatch')
    y=np.array([row['actual'] for row in rows])
    for name,metrics in r['aggregate'].items():
        actual=forecasts_metrics(y,[row[name] for row in rows])
        for k,v in actual.items():np.testing.assert_allclose(metrics[k],v,atol=1e-12)
    for w in r['windows']:
        subset=[row for row in rows if row['origin']==w['origin']]
        for name,metrics in w['models'].items():
            actual=forecasts_metrics([row['actual'] for row in subset],[row[name] for row in subset])
            for k,v in actual.items():np.testing.assert_allclose(metrics[k],v,atol=1e-12)
    low=np.array([row['q10'] for row in rows]);median=np.array([row['tft'] for row in rows]);high=np.array([row['q90'] for row in rows])
    assert np.all((low<=median)&(median<=high)&(low>=0))
    np.testing.assert_allclose(r['interval']['coverage'],np.mean((y>=low)&(y<=high)))
    np.testing.assert_allclose(r['interval']['mean_width'],np.mean(high-low))
    for level,p in zip([.1,.5,.9],[low,median,high]):
        delta=y-p;np.testing.assert_allclose(r['interval']['pinball'][str(level)],np.maximum(level*delta,(level-1)*delta).mean())
    assert r['decoder_target_invariance_max_error']<1e-5
    assert 'quantity' not in r['architecture']['decoder_reals']
    return r

if __name__=='__main__':
    kind=sys.argv[1] if len(sys.argv)>1 else 'ranking'
    pointer=json.loads((ROOT/f'artifacts/advanced-{kind}.json').read_text());run=ROOT/'artifacts/advanced-runs'/pointer['run_id']
    if kind in ['ranking','graph']:verify_ranking(run)
    elif kind=='tft':verify_tft(run)
    else:verify_run(run)
    print('Verified',run.name)

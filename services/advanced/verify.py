"""Verify saved advanced artifacts without rerunning training or changing reports."""
import json
from pathlib import Path
import sys
import numpy as np
from common import ROOT,sha,rank_metrics

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
if __name__=='__main__':
    kind=sys.argv[1] if len(sys.argv)>1 else 'ranking'
    pointer=json.loads((ROOT/f'artifacts/advanced-{kind}.json').read_text());run=ROOT/'artifacts/advanced-runs'/pointer['run_id']
    if kind=='ranking':verify_ranking(run)
    else:verify_run(run)
    print('Verified',run.name)

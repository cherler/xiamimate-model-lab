"""Audit frozen study, label access and paired intervals; never rerank or retrain."""
import json
from pathlib import Path
import numpy as np
from .run import ROOT,load,sha,save
from .colbert_study import METHODS,aggregate
from .core import metrics

def verify(dest):
    p=load(dest/'case.json');f=load(dest/'frozen.json');digest=sha((dest/'frozen.json').read_bytes())
    assert p['frozen_sha256']==digest==load(dest/'frozen-hash.json')['sha256']==load(dest/'development-label-access.json')['frozen_sha256']
    assert len(p['rows'])==len(f['rows'])==300
    for name,d in f['source_sha256'].items():assert sha((dest/name).read_bytes())==d
    parent=ROOT/'artifacts/retrieval-runs'/p['protocol']['parent_run']
    assert sha((parent/'case.json').read_bytes())==f['parent_sha256']
    assert sha((parent/'rankings.json').read_bytes())==f['parent_rankings_sha256']
    source={r['id']:r for r in load(parent/'case.json')['queries']}
    for r,old in zip(p['rows'],f['rows']):
        assert {k:v for k,v in r.items() if k not in ['metrics','candidate_recall','relevant']}==old
        assert r['relevant']==source[r['id']]['relevant']
        for m in METHODS:assert r['metrics'][m]==metrics(r['rankings'][m],r['relevant'])
    assert p['summary']==aggregate(p['rows'])
    for c in p['comparisons']:
        delta=np.array([r['metrics'][c['model']]['ndcg_at_10']-r['metrics'][c['baseline']]['ndcg_at_10'] for r in p['rows']])
        rng=np.random.default_rng(42);ci=np.quantile(delta[rng.integers(300,size=(2000,300))].mean(1),[.025,.975])
        np.testing.assert_allclose(c['bootstrap_ci95'],ci,rtol=0,atol=1e-12)
    return p
if __name__=='__main__':
    p=verify(ROOT/'artifacts/colbert-runs'/load(ROOT/'artifacts/colbert-latest.json')['run_id'])
    report={k:p[k] for k in ['run_id','protocol','core_parity','costs','summary','comparisons','timing','groups','environment','source_sha256','frozen_sha256']}
    report['case_sha256']=sha((ROOT/'artifacts/colbert-runs'/p['run_id']/'case.json').read_bytes())
    save(ROOT/'docs/evaluation/colbert-development-v1.json',report)
    print('Verified frozen study, known-label access, metrics and paired intervals:',p['run_id'])

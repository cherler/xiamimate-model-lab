"""Numerical threshold correction using original calibration only; no refit/test selection."""
import argparse,copy,json,hashlib
from pathlib import Path
import numpy as np
import joblib
from . import run
from .metrics import summary,counts
from .features import features
PARENT=run.STORE
OUT=PARENT.with_name(PARENT.name+'-threshold-fix')

def strict_cut(scores,target=.01):
    a=np.asarray(scores)
    if a.dtype.kind!='f' or not len(a) or not np.isfinite(a).all():raise ValueError('Invalid calibration scores')
    s=np.sort(a);allowed=int(np.floor(len(s)*target))
    # Move to the next representable value in the SCORE dtype, not float64 followed by a float32 comparison.
    cut=float(np.nextafter(s[len(s)-allowed-1],a.dtype.type(np.inf)))
    if int((a>=cut).sum())>allowed:raise ValueError('Calibration target violated')
    return cut

def calculate():
    import torch
    torch.set_num_threads(1)
    d=run.load_data();split={k:np.array(v) for k,v in json.loads((PARENT/'split.json').read_text()).items()};old=json.loads((PARENT/'frozen.json').read_text());models=joblib.load(PARENT/'models.joblib');scores=dict(np.load(PARENT/'scores.npz'))
    if run.sha((PARENT/'models.joblib').read_bytes())!=old['models_sha256'] or run.sha((PARENT/'scores.npz').read_bytes())!=old['scores_sha256']:raise ValueError('Parent artifacts changed')
    report=json.loads((PARENT/'report.json').read_text());source=json.loads((PARENT/'source.json').read_text())
    if run.sha((run.ROOT/'data/anticheat/prepared.npz').read_bytes())!=source['prepared_sha256']:raise ValueError('Input changed')
    ids=split['calibration'];ids=ids[np.isin(d['kinds'][ids],['none','ease_light','ease_strong'])];cy=(d['kinds'][ids]!='none').astype(int);cw=d['windows'][ids];cx=features(cw)
    cuts={};cal={}
    for name,m in models.items():
        v=run.predict(name,m,cw,cx);cuts[name]=strict_cut(v[cy==0]);cal[name]=counts(cy,v,cuts[name])
    # No held-out values consulted to choose the thresholds above.
    frozen={'thresholds':cuts,'calibration':cal,'parent_frozen_sha256':run.sha((PARENT/'frozen.json').read_bytes()),'correction':'nextafter in score dtype; same target/normal calibration windows; no refit','parent_test_already_known':True}
    return d,split,models,scores,report,frozen

def derive(d,split,models,scores,report,frozen):
    r=copy.deepcopy(report);test=split['test'];w=d['windows'][test];kinds=d['kinds'][test];y=(kinds!='none').astype(int);groups=d['groups'][test];known=np.isin(kinds,['none','ease_light','ease_strong'])
    for name,m in models.items():
        score=run.predict(name,m,w,features(w));np.testing.assert_allclose(score,scores[name],rtol=1e-5,atol=1e-7)
        cut=frozen['thresholds'][name];v=r['models'][name];v.update(threshold=cut,calibration=frozen['calibration'][name],known=summary(y[known],score[known],cut,groups[known]),all=summary(y,score,cut,groups))
        for k in v['types']:
            mask=np.isin(kinds,['none',k]);v['types'][k]=summary(y[mask],score[mask],cut,groups[mask])
    for condition,z in [('half_rate_hold',np.repeat(w[:,::2],2,axis=1)[:,:35]),('last_five_missing',np.concatenate([w[:,:30],np.zeros_like(w[:,30:])],axis=1))]:
        r['quality_stress'][condition]=summary(y,run.predict('lightgbm',models['lightgbm'],z),frozen['thresholds']['lightgbm'],groups)
    r['evaluation_revision']='threshold-fix-v1';r['correction_note']='单精度阈值边界数值修正，使用原正常校准集；模型与分数未变。原留出成绩已知，本次为更正回放，不是新的独立测试。'
    return r

def correct():
    if OUT.exists():raise ValueError('Correction already frozen; use verify')
    d,split,models,scores,report,frozen=calculate();OUT.mkdir()
    run.write(OUT/'frozen.json',frozen) # Freeze corrected thresholds before replaying test outcomes.
    run.write(OUT/'audit.json',{'at':run.now(),'parent_report_sha256':run.sha((PARENT/'report.json').read_bytes()),'source_sha256':run.sha(Path(__file__).read_bytes()),'scope':'Numerical bug correction only, known test replay; no training or test-driven threshold optimization'})
    r=derive(d,split,models,scores,report,frozen);run.write(OUT/'report.json',r);run.export(r);print('Corrected calibration:',{k:v['fpr'] for k,v in frozen['calibration'].items()})

def verify():
    import torch
    torch.set_num_threads(1)
    for name,digest in json.loads((PARENT/'source-hashes.json').read_text()).items():
        if run.sha((run.SOURCE/name).read_bytes())!=digest:raise ValueError('Parent training source changed')
    audit=json.loads((OUT/'audit.json').read_text())
    if run.sha(Path(__file__).read_bytes())!=audit['source_sha256'] or run.sha((PARENT/'report.json').read_bytes())!=audit['parent_report_sha256']:raise ValueError('Correction provenance changed')
    d,split,models,scores,report,frozen=calculate();assert frozen==json.loads((OUT/'frozen.json').read_text())
    sets=[set(d['groups'][v]) for v in split.values()];assert not any(sets[i]&sets[j] for i in range(3) for j in range(i))
    r=derive(d,split,models,scores,report,frozen);assert r==json.loads((OUT/'report.json').read_text())
    for sample in r['samples']:
        idx=int(sample['id'].split('-')[1]);np.testing.assert_allclose(d['windows'][idx],sample['trajectory'])
        x=features(d['windows'][idx:idx+1]);np.testing.assert_allclose(x[0],sample['features'])
        c=models['lightgbm'].booster_.predict(x,pred_contrib=True,num_threads=1)[0];np.testing.assert_allclose(c,np.r_[sample['lightgbm_contributions'],sample['lightgbm_base']])
    run.export(r);print('Verified corrected thresholds, unchanged predictions, all cohort metrics, stress results and sample explanations; no retraining.')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['correct','verify']);a=p.parse_args();correct() if a.action=='correct' else verify()

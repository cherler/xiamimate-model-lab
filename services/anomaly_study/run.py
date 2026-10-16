"""Frozen scores before known-label scoring; content-addressed static export."""
import json,sys,platform,shutil
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
import pandas as pd
import joblib,sklearn
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import RobustScaler
from services.monitoring.common import ROOT,load,save,sha
from services.monitoring.anomaly import causal_features
from .audit import RAW,clean
from .core import METHODS,calibrate,evaluate,summaries,brief
P=ROOT/'services/anomaly_study/protocol.json'
A=ROOT/'docs/evaluation/anomaly-cross-audit-v1.json'
LATEST=ROOT/'artifacts/anomaly-cross-latest.json'
OUT=ROOT/'apps/web/anomaly-cross-results'

def check_sources(cfg,audit):
    if sha(A)!=cfg['audit_sha256'] or sha(ROOT/'services/monitoring/anomaly.py')!=cfg['feature_source_sha256']:raise ValueError('Protocol source changed')
    for name,digest in audit['files'].items():
        if sha(RAW/name)!=digest:raise ValueError('Source mismatch '+name)

def run():
    cfg,audit=load(P),load(A);check_sources(cfg,audit)
    run_id='anomaly-cross-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');dest=ROOT/'artifacts/anomaly-cross-runs'/run_id;dest.mkdir(parents=True)
    save(dest/'protocol.json',cfg);save(dest/'audit.json',audit)
    for name in ['run.py','core.py','audit.py']:shutil.copyfile(Path(__file__).parent/name,dest/name)
    series=[];models={}
    for meta in audit['series']:
        if not meta['included']:continue
        f,_=clean(RAW/meta['path']);values=f.value.to_numpy(float);n=len(f);a,b=meta['train_end'],meta['cal_end'];train=values[:a]
        center=np.median(train);floor=max(float(np.subtract(*np.percentile(train,[75,25])))*.01,1e-8)
        scale=max(float(1.4826*np.median(np.abs(train-center))),floor)
        X,rolling,_=causal_features(f.timestamp,values,floor);valid=np.isfinite(X).all(axis=1)&np.isfinite(rolling);fit=valid&(np.arange(n)<a)
        scaler=RobustScaler().fit(X[fit]);forest=IsolationForest(**cfg['isolation_forest'],random_state=cfg['seed']).fit(scaler.transform(X[fit]));iso=np.full(n,np.nan);iso[valid]=-forest.score_samples(scaler.transform(X[valid]))
        scores={'static':abs(values-center)/scale,'rolling':rolling,'isolation':iso}
        rows=[{'t':int(f.timestamp.iloc[i].value//10**6),'v':float(values[i]),'scores':{m:float(scores[m][i]) for m in METHODS} if valid[i] else None} for i in range(n)]
        cal=rows[a:b];calibration={str(B):{m:calibrate(cal,m,B,meta['split_hours'][1]/24,cfg['quantiles']) for m in METHODS} for B in cfg['budgets']}
        series.append({'id':meta['id'],'meta':meta,'rows':rows,'calibration':calibration});models[meta['id']]={'scaler':scaler,'forest':forest,'center':float(center),'scale':scale,'floor':floor}
        print('Frozen',meta['id'],flush=True)
    save(dest/'frozen.json',series);joblib.dump(models,dest/'models.joblib')
    frozen=sha(dest/'frozen.json');access={'status':'opened','frozen_sha256':frozen,'known_labels':True,'message':'Public labels previously accessed by R5; no unseen test claim.'};save(dest/'label-access.json',access)
    labels=load(RAW/'labels/combined_windows.json')
    for s in series:
        ev=s['rows'][s['meta']['cal_end']:];start,end=ev[0]['t'],ev[-1]['t'];windows=[];source=labels[s['id']+'.csv']
        for x,y in source:
            lo,hi=int(pd.Timestamp(x).value//10**6),int(pd.Timestamp(y).value//10**6)
            if hi>=start and lo<=end:windows.append({'start':max(lo,start),'end':min(hi,end),'original_start':lo,'original_end':hi,'clipped':lo<start or hi>end})
        if any(windows[i]['start']<=windows[i-1]['end'] for i in range(1,len(windows))):raise ValueError('Overlapping windows')
        s['windows']=windows;s['source_event_count']=len(source);s['results']={str(B):{m:{mode:evaluate(ev,windows,m,s['calibration'][str(B)][m]['threshold'],s['meta']['split_hours'][2]/24,B if mode=='capped' else None) for mode in ['capped','uncapped']} for m in METHODS} for B in cfg['budgets']}
    save(dest/'series.json',series);access['status']='completed';save(dest/'label-access.json',access)
    manifest={'schema':'anomaly-cross-v1','run_id':run_id,'protocol':cfg,'protocol_sha256':sha(P),'audit_sha256':sha(A),'audit':audit,'frozen_sha256':frozen,'models_sha256':sha(dest/'models.joblib'),'access':access,'source_code':{p:sha(dest/p) for p in ['run.py','core.py','audit.py']},'environment':{'python':platform.python_version(),'sklearn':sklearn.__version__},'notice':'NAB — Ahmad, Lavin, Purdy & Agha (2017), Unsupervised real-time anomaly detection for streaming data. https://doi.org/10.1016/j.neucom.2017.04.070\nhttps://github.com/numenta/NAB\nLocal causal features and alert replay; not official NAB scores.\n'+(RAW/'LICENSE.txt').read_text(),'data_readme':(RAW/'data/README.md').read_text()}
    save(dest/'manifest.json',manifest);save(LATEST,{'run_id':run_id});verify()

def verify():
    dest=ROOT/'artifacts/anomaly-cross-runs'/load(LATEST)['run_id'];cfg=load(dest/'protocol.json');audit=load(A);check_sources(cfg,audit)
    meta=load(dest/'manifest.json');series=load(dest/'series.json');frozen=load(dest/'frozen.json');models=joblib.load(dest/'models.joblib')
    if sha(P)!=meta['protocol_sha256'] or sha(dest/'frozen.json')!=meta['frozen_sha256'] or sha(dest/'models.joblib')!=meta['models_sha256'] or load(dest/'label-access.json')!=meta['access']:raise ValueError('Frozen artifact changed')
    for name,digest in meta['source_code'].items():
        if sha(dest/name)!=digest or sha(Path(__file__).parent/name)!=digest:raise ValueError('Experiment code changed '+name)
    if [s['id'] for s in series]!=cfg['series']:raise ValueError('Incomplete series')
    labels=load(RAW/'labels/combined_windows.json')
    for s,old in zip(series,frozen):
        if any(s[k]!=old[k] for k in old):raise ValueError('Post-label scores changed')
        f,_=clean(RAW/s['meta']['path']);model=models[s['id']];X,roll,_=causal_features(f.timestamp,f.value.to_numpy(float),model['floor']);valid=np.isfinite(X).all(axis=1)&np.isfinite(roll);iso=-model['forest'].score_samples(model['scaler'].transform(X[valid]));expected={'static':abs(f.value.to_numpy(float)-model['center'])/model['scale'],'rolling':roll,'isolation':np.full(len(f),np.nan)};expected['isolation'][valid]=iso
        if len(s['rows'])!=len(f):raise ValueError('Source row count')
        for i,r in enumerate(s['rows']):
            if r['t']!=int(f.timestamp.iloc[i].value//10**6) or r['v']!=float(f.value.iloc[i]) or (r['scores'] is None)!=bool(not valid[i]):raise ValueError('Source row/validity mismatch')
            if valid[i] and any(not np.isclose(r['scores'][m],expected[m][i],rtol=1e-12,atol=1e-12) for m in METHODS):raise ValueError('Saved model score mismatch')
        a,b=s['meta']['train_end'],s['meta']['cal_end'];ev=s['rows'][b:];windows=[]
        for x,y in labels[s['id']+'.csv']:
            lo,hi=int(pd.Timestamp(x).value//10**6),int(pd.Timestamp(y).value//10**6)
            if hi>=ev[0]['t'] and lo<=ev[-1]['t']:windows.append({'start':max(lo,ev[0]['t']),'end':min(hi,ev[-1]['t']),'original_start':lo,'original_end':hi,'clipped':lo<ev[0]['t'] or hi>ev[-1]['t']})
        if windows!=s['windows']:raise ValueError('Window mismatch')
        for B in cfg['budgets']:
            for m in METHODS:
                cal=calibrate(s['rows'][a:b],m,B,s['meta']['split_hours'][1]/24,cfg['quantiles'])
                if cal!=s['calibration'][str(B)][m]:raise ValueError('Calibration mismatch')
                for mode in ['capped','uncapped']:
                    if evaluate(ev,windows,m,cal['threshold'],s['meta']['split_hours'][2]/24,B if mode=='capped' else None)!=s['results'][str(B)][m][mode]:raise ValueError('Replay mismatch')
    OUT.mkdir(parents=True,exist_ok=True);index={**meta,'summary':summaries(series),'series':[]}
    for s in series:
        tmp=OUT/'series.tmp';save(tmp,s);digest=sha(tmp);name=digest+'.json';tmp.replace(OUT/name);index['series'].append({**brief(s),'asset':{'path':name,'sha256':digest}})
    save(OUT/'index.tmp',index);digest=sha(OUT/'index.tmp');(OUT/'index.tmp').replace(OUT/(digest+'.json'));save(OUT/'manifest.json',{'path':digest+'.json','sha256':digest,'run_id':meta['run_id']})
    save(ROOT/'docs/evaluation/anomaly-cross-export-v1.json',{'run_id':meta['run_id'],'index_sha256':digest,'protocol_sha256':meta['protocol_sha256'],'series':len(series),'summary':index['summary']})
    print(json.dumps({'run_id':meta['run_id'],'series':len(series),'default':index['summary']['3']},ensure_ascii=False))
if __name__=='__main__':run() if len(sys.argv)<2 or sys.argv[1]=='run' else verify()

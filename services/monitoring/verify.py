"""Verify saved R5 outputs against frozen files, models and source records; no refitting."""
import argparse
import numpy as np
import pandas as pd
import joblib
from .common import ROOT, ART, load, sha, export
from .anomaly import causal_features, evaluate, METHODS
from .segments import rfm_at, future_at, profiles, transitions


def verify(kind):
    dest=ART/load(ROOT/f'artifacts/monitoring-{kind}.json')['run_id'];p=load(dest/'case.json')
    frozen=dest/('frozen-scores.json' if kind=='anomaly' else 'frozen-groups.json')
    if sha(frozen)!=p['frozen_sha256'] or sha(dest/'models.joblib')!=p['model_sha256'] or sha(dest/'protocol.json')!=p['protocol_sha256']:raise ValueError('Frozen file changed')
    if load(dest/'protocol.json')!=p['protocol']:raise ValueError('Protocol changed')
    models=joblib.load(dest/'models.joblib')  # Only this locally produced, hash-verified model file.
    if kind=='anomaly':
        labels_path=ROOT/'data/raw/r5/combined_windows.json'
        if sha(labels_path)!=p['protocol']['nab']['files']['labels/combined_windows.json']:raise ValueError('Window source changed')
        labels=load(labels_path)
        saved=load(frozen)
        if len(saved)!=len(p['series']):raise ValueError('Frozen series count changed')
        for old,s in zip(saved,p['series']):
            for key in old:
                if old[key]!=s[key]:raise ValueError('Frozen scores changed')
            source=ROOT/'data/raw/r5'/f"{s['id']}.csv"
            if sha(source)!=s['source_sha256']:raise ValueError('Source changed')
            d=pd.read_csv(source);d.timestamp=pd.to_datetime(d.timestamp);d=d.drop_duplicates('timestamp',keep='first').sort_values('timestamp',kind='stable').reset_index(drop=True)
            np.testing.assert_allclose(d.value,[r['v'] for r in s['rows']],rtol=0,atol=0)
            if (d.timestamp.astype('int64')//1000000).tolist()!=[r['t'] for r in s['rows']]:raise ValueError('Timestamps changed')
            train=d.value.to_numpy()[:s['train_end']];center=np.median(train)
            static=np.abs(d.value.to_numpy()-center)/max(float(1.4826*np.median(np.abs(train-center))),s['scale_floor'])
            np.testing.assert_allclose(static[[r['scores'] is not None for r in s['rows']]],[r['scores']['static'] for r in s['rows'] if r['scores']])
            X,rolling,_=causal_features(d.timestamp,d.value.to_numpy(),s['scale_floor']);valid=np.array([r['scores'] is not None for r in s['rows']])
            np.testing.assert_allclose(X[valid],[r['features'] for r in s['rows'] if r['scores']])
            np.testing.assert_allclose(rolling[valid],[r['scores']['rolling'] for r in s['rows'] if r['scores']])
            model=models[s['id']];scores=-model['isolation_forest'].score_samples(model['scaler'].transform(X[valid]));np.testing.assert_allclose(scores,[r['scores']['isolation'] for r in s['rows'] if r['scores']])
            rows=[r for r in s['rows'] if r['split']=='evaluation' and r['scores']]
            selected=[];start,end=rows[0]['t'],rows[-1]['t']
            for a,b in labels['realKnownCause/'+s['id']+'.csv']:
                x,y=int(pd.Timestamp(a).value//1000000),int(pd.Timestamp(b).value//1000000)
                if y>=start and x<=end:selected.append({'start':max(x,start),'end':min(y,end),'original_start':x,'original_end':y,'clipped':x<start or y>end})
            if selected!=s['windows']:raise ValueError('Scored windows changed')
            for m in METHODS:
                if evaluate(rows,s['windows'],m,s['thresholds'][m])!=s['metrics'][m]:raise ValueError('Alert metrics changed')
        if p['access']!=load(dest/'label-access.json'):raise ValueError('Label access changed')
    else:
        cache=ROOT/'data/processed/transactions.csv.gz'
        if sha(cache)!=p['audit']['processed_sha256']:raise ValueError('Retail cache changed')
        df=pd.read_csv(cache,dtype={'customer':'string','invoice':str,'item':str},parse_dates=['date'])
        saved=load(frozen)
        if len(saved)!=len(p['snapshots']):raise ValueError('Frozen snapshot count changed')
        for old,s in zip(saved,p['snapshots']):
            if len(old['rows'])!=len(s['rows']):raise ValueError('Frozen customer count changed')
            for a,b in zip(old['rows'],s['rows']):
                for key in a:
                    if a[key]!=b[key]:raise ValueError('Frozen groups changed')
            rfm=rfm_at(df,s['origin']);future=future_at(df,rfm.index.tolist(),s['origin'])
            if rfm.index.tolist()!=[r['id'] for r in s['rows']]:raise ValueError('Customer scope changed')
            np.testing.assert_allclose(rfm,[r['rfm'] for r in s['rows']])
            labels=models['kmeans'].predict(models['scaler'].transform(np.log1p(rfm.to_numpy(float))))
            if [models['mapping'][int(v)] for v in labels]!=[r['cluster'] for r in s['rows']]:raise ValueError('Model groups changed')
            np.testing.assert_allclose(future,[ [r['future_orders'],r['future_gross']] for r in s['rows']])
            for m in ['cluster','rule']:
                if profiles(s['rows'],m)!=s['profiles'][m]:raise ValueError('Profile changed')
        for m in ['cluster','rule']:
            if transitions(p['snapshots'][0]['rows'],p['snapshots'][1]['rows'],m)!=p['transitions'][m]:raise ValueError('Transitions changed')
    export(kind,dest);print('Verified',kind,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('kind',choices=['anomaly','segments','all'],default='all',nargs='?');kind=parser.parse_args().kind
    for name in ['anomaly','segments'] if kind=='all' else [kind]:verify(name)

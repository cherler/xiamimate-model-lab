"""Publish frozen UCI results and every UI recommendation setting, without refitting."""
import os
for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS']:os.environ[key]='2'
import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path
import numpy as np
import pandas as pd
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'services'))
from server import Artifacts
from ml.core import ranking_metrics
from ml.forecasting import forecast_metrics

RUN='retail-20261012T001149Z'
OUT=ROOT/'apps/web/uci-results'
MODELS=['popular','itemcf','basket','als','ease','personal_frequency','personal_recent','personal_decay','hybrid']
EXPLORATION=list(range(0,101,10))
NOTICE='Chen, D. (2012). Online Retail II. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D . CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . Source: https://archive.ics.uci.edu/dataset/502/online+retail+ii . Local adaptation: cleaning, time splits, forecasting and saved recommendation replay. Known development data, not customer outcomes; no new training or independent test. Interactive settings replay the frozen 2011-11-01 model for the original 24 demonstration customers and a cold-start example.'


def read(p):return json.loads(Path(p).read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,v):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,allow_nan=False,separators=(',',':'))+'\n')
def near(a,b):
    if a is None or b is None:
        if a is not b:raise ValueError('Null metric mismatch')
    elif not np.isclose(a,b,rtol=1e-9,atol=1e-10):raise ValueError(f'Metric mismatch {a} != {b}')


def verify_source(run):
    sums=read(run/'checksums.json')
    for name,digest in sums.items():
        p=(run/name).resolve()
        if not p.is_relative_to(run.resolve()) or sha(p)!=digest:raise ValueError('Source checksum mismatch: '+name)
    report=read(run/'report.json')
    if report['run_id']!=RUN or report['schema_version']!=3:raise ValueError('Only the frozen third-round UCI run is publishable')
    for filename,key in [('forecast-series.json','forecast'),('weekly-series.json','weekly')]:
        rows=read(run/filename);models=report[key]['models'];origins=[w['origin'] for w in report[key]['windows']]
        if len(rows)!=(36 if key=='forecast' else 144):raise ValueError('Forecast scope mismatch')
        for origin in [None,*origins]:
            part=rows if origin is None else [s for s in rows if s['origin']==origin]
            a=np.array([s['actual'] for s in part]).ravel()
            for model in models:
                pred=np.array([s['predictions'][model] for s in part]).ravel();observed=forecast_metrics(a,pred)
                expected=models[model]['metrics'] if origin is None else next(w for w in report[key]['windows'] if w['origin']==origin)['models'][model]
                for metric,value in observed.items():near(value,expected[metric])
        for row in rows:
            if any(day>=row['origin'] for day in row['history_dates']):raise ValueError('History crosses forecast origin')
            if key=='forecast':
                for model in models:
                    for k,v in forecast_metrics(row['actual'],row['predictions'][model]).items():near(v,row['metrics'][model][k])
    # Original recommendation reports average customer scores within a window, then windows equally.
    for model in MODELS:
        frame=pd.read_csv(run/f'validation-predictions-{model}.csv.gz',dtype={'customer':str});m=report['recommendation']['models'][model]
        if len(frame)!=m['user_windows']:raise ValueError('Recommendation scope mismatch')
        for row in frame.to_dict('records'):
            calc=ranking_metrics(json.loads(row['ranked']),set(json.loads(row['target'])),10)
            for key,value in calc.items():near(value,row[key])
        for window in m['windows']:
            f=frame[frame.origin==window['origin']]
            if len(f)!=window['users']:raise ValueError('Customer window mismatch')
            for key in ['recall','ndcg','hit_rate']:near(f[key].mean(),window[key])
        for key in ['recall','ndcg','hit_rate']:near(np.mean([w[key] for w in m['windows']]),m['metrics'][key])
    return sums,report


def customer_bundle(store,user):
    models={}
    for model in MODELS:
        products={};variants={};fallback=None
        for exclude in [False,True]:
            for explore in EXPLORATION:
                result=store.recommend({'customer_id':user,'strategy':model,'limit':20,'exclude_purchased':exclude,'exploration':explore})
                fallback=result['fallback'];ids=[];scores=[]
                for row in result['items']:
                    ids.append(row['id']);scores.append(row['score'])
                    meta={k:v for k,v in row.items() if k!='score'}
                    if 'exploration' in meta['reason']:meta['reason']['exploration']=0
                    if row['id'] in products and products[row['id']]!=meta:raise ValueError('Unstable item explanation')
                    products[row['id']]=meta
                variants[f'{int(exclude)}:{explore}']={'ids':ids,'scores':scores}
        models[model]={'fallback':fallback,'products':products,'variants':variants}
    return {'schema':'uci-customer-v1','run_id':store.run_id,'as_of':store.model['as_of'],'customer_id':user,
            'history':store.profiles.get(user,[]),'history_items':len(store.model['histories'].get(user,[])),'models':models}


def export():
    run=ROOT/'artifacts/runs'/RUN;sums,report=verify_source(run);OUT.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as working:
        temporary=Path(working);(temporary/'artifacts').mkdir();(temporary/'artifacts/runs').symlink_to(ROOT/'artifacts/runs',target_is_directory=True)
        write(temporary/'artifacts/latest.json',{'run_id':RUN});store=Artifacts(temporary).load()
        staged=temporary/'publish';staged.mkdir();customers=store.model['demo_users']
        names=['report.json','forecast-series.json','weekly-series.json','diagnostics.json','checksums.json','forecast-predictions.csv.gz','weekly-predictions.csv.gz','recommendation-diagnostics.csv.gz',*[f'validation-predictions-{m}.csv.gz' for m in MODELS]]
        for name in names:shutil.copyfile(run/name,staged/name)
        write(staged/'customers.json',{'customers':customers,'as_of':store.model['as_of'],'run_id':RUN})
        for user in [*customers,'new']:
            write(staged/f'customer-{user}.json',customer_bundle(store,user));print('Saved frozen recommendations:',user,flush=True)
        (staged/'NOTICE.txt').write_text(NOTICE+'\n')
        files={p.name:{'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(staged.iterdir())}
        manifest={'schema':'uci-static-v1','run_id':RUN,'as_of':store.model['as_of'],'customers':customers,'models':MODELS,'exploration':EXPLORATION,'max_limit':20,'files':files,'source_checksums_sha256':sha(run/'checksums.json'),'notice':'NOTICE.txt'}
        version=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()[:16];manifest['version']=version
        target=OUT/version
        if target.exists():
            if {p.name:sha(p) for p in target.iterdir() if p.is_file()}!={n:r['sha256'] for n,r in files.items()}:raise ValueError('Immutable export version changed')
        else:shutil.move(staged,target)
        write(OUT/'manifest.json.tmp',manifest);(OUT/'manifest.json.tmp').replace(OUT/'manifest.json')
        print('Published',version,'files',len(files),'bytes',sum(s['bytes'] for s in files.values()),'settings',len(customers+['new'])*len(MODELS)*2*len(EXPLORATION),flush=True)


if __name__=='__main__':
    argparse.ArgumentParser(description=__doc__).parse_args();export()

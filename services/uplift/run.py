"""Frozen multi-arm uplift experiment. No online training or true individual-effect labels."""
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):
    os.environ.setdefault(key,'2')
import argparse, hashlib, json, time, urllib.request
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, LGBMRegressor
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.linear_model import Ridge
import joblib

ROOT=Path(__file__).resolve().parents[2]
PROTOCOL=Path(__file__).with_name('protocol.json')
P=json.loads(PROTOCOL.read_text())
DATA=ROOT/'data/uplift/hillstrom.csv.gz'
STORE=ROOT/'artifacts/uplift-runs'/P['id']
MODELS=P['models']
BASES=['response','history','random']

def sha(data): return hashlib.sha256(data).hexdigest()
def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
def prepare():
    if not DATA.exists():
        DATA.parent.mkdir(parents=True,exist_ok=True)
        with urllib.request.urlopen(P['download'],timeout=60) as r: DATA.write_bytes(r.read())
    if hashlib.md5(DATA.read_bytes()).hexdigest()!=P['download_md5']: raise ValueError('Source hash mismatch')
    return pd.read_csv(DATA)
def predict(model,x):
    return model.predict_proba(x)[:,1] if isinstance(model,LGBMClassifier) else model.predict(x)
def fit(x,y,binary=False,weights=None):
    params={**P['lightgbm'],'random_state':P['seed']}
    model=(LGBMClassifier if binary else LGBMRegressor)(**params)
    model.fit(x,y,sample_weight=weights)
    return model

def train_models(x,t,y,eval_x,binary):
    """All nuisance models train only on train rows. Known randomized assignment p is used."""
    fitted={};scores={}
    onehot=np.eye(3)[t]
    fitted['s']=fit(np.c_[x,onehot],y,binary)
    mus=np.stack([predict(fitted['s'],np.c_[eval_x,np.tile(np.eye(3)[a],(len(eval_x),1))]) for a in range(3)],axis=1)
    scores['s']=mus[:,1:]-mus[:,[0]]
    fitted['t']=[fit(x[t==a],y[t==a],binary) for a in range(3)]
    mu=np.stack([predict(m,eval_x) for m in fitted['t']],axis=1)
    scores['t']=mu[:,1:]-mu[:,[0]]
    scores['response']=mu[:,1:]
    for name in ['x','r','linear_dml']:
        scores[name]=np.zeros((len(eval_x),2));fitted[name]=[]
    for a in [1,2]:
        idx=(t==0)|(t==a);xp=x[idx];yp=y[idx];tp=(t[idx]==a).astype(int)
        d0=predict(fitted['t'][a],xp[tp==0])-yp[tp==0]
        d1=yp[tp==1]-predict(fitted['t'][0],xp[tp==1])
        x0=fit(xp[tp==0],d0);x1=fit(xp[tp==1],d1)
        # g(x)=P(T=a | T in {0,a})=1/2, weighting control imputation by g.
        scores['x'][:,a-1]=.5*predict(x0,eval_x)+.5*predict(x1,eval_x)
        fitted['x'].append([x0,x1])
        m=np.zeros(len(xp));nuisance=[]
        for tr,va in StratifiedKFold(P['crossfit_folds'],shuffle=True,random_state=P['seed']).split(xp,tp):
            model=fit(xp[tr],yp[tr],binary);m[va]=predict(model,xp[va]);nuisance.append(model)
        residual_t=tp-.5;residual_y=yp-m
        r=fit(xp,residual_y/residual_t,weights=residual_t**2)
        scores['r'][:,a-1]=predict(r,eval_x);fitted['r'].append({'tau':r,'nuisance':nuisance})
        scaler=StandardScaler().fit(xp);phi=np.c_[np.ones(len(xp)),scaler.transform(xp)]
        linear=Ridge(alpha=1.0,fit_intercept=False).fit(phi*residual_t[:,None],residual_y)
        scores['linear_dml'][:,a-1]=linear.predict(np.c_[np.ones(len(eval_x)),scaler.transform(eval_x)])
        fitted['linear_dml'].append({'tau':linear,'scaler':scaler,'nuisance':nuisance})
    return scores,fitted

def policy(scores,cap):
    n=len(scores);best=np.argmax(scores,axis=1)+1;rank=np.max(scores,axis=1)
    selected=np.lexsort((np.arange(n),-rank))[:int(np.floor(cap*n))]
    action=np.zeros(n,dtype=np.int8);action[selected]=best[selected]
    return action

def contributions(t,y,action):
    # Increment relative to sending nobody; rows assigned no-action cancel exactly.
    p=np.asarray(P['propensity'])[t]
    return y*((t==action).astype(float)-(t==0).astype(float))/p

def random_contributions(t,y,cap):
    return y*np.where(t==0,-cap,cap/2)/np.asarray(P['propensity'])[t]

def estimate(v):
    mean=float(np.mean(v));se=float(np.std(v,ddof=1)/np.sqrt(len(v)))
    return {'mean':mean,'lo':mean-1.96*se,'hi':mean+1.96*se,'n':len(v)}

def history_scores(frame):
    # Fixed pre-treatment heuristic: prefer previously purchased merchandise, rank historical value.
    preferred=np.where(frame.mens.to_numpy()>=frame.womens.to_numpy(),0,1)
    s=np.full((len(frame),2),-1e20);s[np.arange(len(frame)),preferred]=frame.history.to_numpy()
    return s

def summarize(scores,t,y,cap,model):
    action=policy(scores[model],cap)
    baseline=policy(scores['response'],cap)
    result={'contact':int((action>0).sum()),'arms':([len(t)*(1-cap),len(t)*cap/2,len(t)*cap/2] if model=='random' else np.bincount(action,minlength=3).tolist()),'allocation_kind':('expected_random' if model=='random' else 'fixed_policy'),'outcomes':{}}
    for j,name in enumerate(P['outcomes']):
        v=random_contributions(t,y[:,j],cap) if model=='random' else contributions(t,y[:,j],action)
        base=contributions(t,y[:,j],baseline)
        result['outcomes'][name]={'increment':estimate(v),'vs_response':estimate(v-base)}
    return result

def run():
    if STORE.exists(): raise RuntimeError('Frozen run exists; use verify, not rerun. A changed experiment needs a new protocol ID.')
    frame=prepare()
    if len(frame)!=64000 or frame[P['features']].isna().any().any():raise ValueError('Unexpected dataset')
    t=frame.segment.map({v:i for i,v in enumerate(P['arms'])}).to_numpy()
    if pd.isna(t).any():raise ValueError('Unknown treatment')
    ids=np.arange(len(frame));train,rest=train_test_split(ids,test_size=.4,random_state=P['seed'],stratify=t)
    validation,test=train_test_split(rest,test_size=.5,random_state=P['seed']+1,stratify=t[rest])
    validation=np.sort(validation);test=np.sort(test)
    # Only train rows determine categorical vocabulary and scalers.
    cat=['zip_code','channel'];num=[k for k in P['features'] if k not in cat]
    encoder=OneHotEncoder(handle_unknown='ignore',sparse_output=False).fit(frame.iloc[train][cat])
    def features(rows):return np.c_[frame.iloc[rows][num].to_numpy(float),encoder.transform(frame.iloc[rows][cat])]
    x=features(train);eval_ids=np.r_[validation,test];ex=features(eval_ids)
    # Arrays are stored so the later verifier can recompute each published statistic without retraining.
    STORE.mkdir(parents=True)
    write(STORE/'protocol.json',P)
    (STORE/'training-source.py').write_text(Path(__file__).read_text())
    write(STORE/'split.json',{k:v.tolist() for k,v in [('train',train),('validation',validation),('test',test)]})
    arrays={'t':t[test],'y':frame.iloc[test][P['outcomes']].to_numpy(),'ids':test};fitted={'encoder':encoder,'num':num};chosen={};validation_scores={};timings={}
    for target in P['outcomes']:
        started=time.monotonic();s,models=train_models(x,t[train],frame.iloc[train][target].to_numpy(),ex,target!='spend')
        s['history']=history_scores(frame.iloc[eval_ids]);s['random']=np.zeros((len(eval_ids),2))
        nv=len(validation);yv=frame.iloc[validation][target].to_numpy();tv=t[validation]
        baseline=contributions(tv,yv,policy(s['response'][:nv],.3))
        values={m:float(np.mean(contributions(tv,yv,policy(s[m][:nv],.3))-baseline)) for m in MODELS}
        chosen[target]=max(MODELS,key=values.get);validation_scores[target]=values
        for name,values_array in s.items():arrays[target+'__'+name]=values_array[nv:]
        fitted[target]=models;timings[target]=round(time.monotonic()-started,3)
        print(target,'trained',timings[target],'seconds; selection frozen on validation',flush=True)
    np.savez_compressed(STORE/'predictions.npz',**arrays);joblib.dump(fitted,STORE/'models.joblib')
    freeze={'protocol_sha256':sha(PROTOCOL.read_bytes()),'source_sha256':sha(DATA.read_bytes()),'source_code_sha256':sha(Path(__file__).read_bytes()),'predictions_sha256':sha((STORE/'predictions.npz').read_bytes()),'chosen':chosen,'validation_scores':validation_scores,'timings':timings,'frozen_at':datetime.now(timezone.utc).isoformat()}
    write(STORE/'frozen.json',freeze)
    # Selection is fixed before any test outcome evaluation.
    write(STORE/'test-access.json',{'opened_at':datetime.now(timezone.utc).isoformat(),'selection_sha256':sha((STORE/'frozen.json').read_bytes()),'scope':'first held-out scoring; future changes are known-result research'})
    report=report_from_saved(frame)
    write(STORE/'report.json',report);export(report)
    print(json.dumps({'chosen':chosen,'test_rows':len(test),'run':P['id']},ensure_ascii=False),flush=True)

def report_from_saved(frame):
    freeze=json.loads((STORE/'frozen.json').read_text());split=json.loads((STORE/'split.json').read_text())
    if sha(DATA.read_bytes())!=freeze['source_sha256'] or sha(PROTOCOL.read_bytes())!=freeze['protocol_sha256']:raise ValueError('Protocol/source changed')
    if sha((STORE/'predictions.npz').read_bytes())!=freeze['predictions_sha256']:raise ValueError('Predictions changed')
    if sha((STORE/'training-source.py').read_bytes())!=freeze['source_code_sha256']:raise ValueError('Training source changed')
    a=np.load(STORE/'predictions.npz');t=a['t'];y=a['y'];ids=a['ids'];methods=MODELS+BASES
    report={'schema':1,'run_id':P['id'],'source':P['source'],'download':P['download'],'source_sha256':freeze['source_sha256'],'protocol_sha256':freeze['protocol_sha256'],'protocol':P,'freeze':freeze,'sizes':{k:len(v) for k,v in split.items()},'arms':[],'targets':{}}
    for arm in range(3):
        ix=t==arm;report['arms'].append({'arm':arm,'n':int(ix.sum()),'visits':int(y[ix,0].sum()),'conversions':int(y[ix,1].sum()),'spend':float(y[ix,2].sum())})
    for target in P['outcomes']:
        scores={m:a[target+'__'+m] for m in methods};j=P['outcomes'].index(target)
        rows=[{'method':m,'cap':cap,**summarize(scores,t,y,cap,m)} for cap in P['caps'] for m in methods]
        groups=[];selected=policy(scores[freeze['chosen'][target]],.3)
        for name,mask in [('新客',frame.iloc[ids].newbie.to_numpy()==1),('非新客',frame.iloc[ids].newbie.to_numpy()==0),('近三个月购买',frame.iloc[ids].recency.to_numpy()<=3),('超过三个月未购买',frame.iloc[ids].recency.to_numpy()>3)]:
            if mask.sum():groups.append({'name':name,'n':int(mask.sum()),'contact':int((selected[mask]>0).sum()),'counts':np.bincount(t[mask],minlength=3).tolist(),'increment':estimate(contributions(t,y[:,j],selected)[mask]),'vs_response':estimate((contributions(t,y[:,j],selected)-contributions(t,y[:,j],policy(scores['response'],.3)))[mask])})
        # Deterministic examples, never chosen by uplift, response or outcome.
        samples=[]
        for i in range(min(12,len(ids))):
            r=frame.iloc[ids[i]];samples.append({'id':f'row-{ids[i]+1}','features':{k:r[k].item() if isinstance(r[k],np.generic) else r[k] for k in P['features']},'predictions':{m:scores[m][i].tolist() for m in MODELS},'observed_arm':int(t[i]),'observed_outcome':float(y[i,j])})
        # Binary arm-specific centered cumulative IPW gains (per capita, not normalized library Qini).
        curves=[]
        for arm in [1,2]:
            ix=np.flatnonzero((t==0)|(t==arm));binary=(t[ix]==arm);contrib=y[ix,j]*np.where(binary,2.,-2.)
            for m in MODELS:
                order=np.lexsort((ix,-scores[m][ix,arm-1]));cum=np.r_[0,np.cumsum(contrib[order])]/len(ix);q=np.linspace(0,1,len(cum));centered=cum-q*cum[-1]
                curves.append({'arm':arm,'method':m,'auuc_centered':float(np.trapezoid(centered,q)),'points':[{'share':float(v),'gain':float(cum[int(round(v*len(ix)))]),'random':float(v*cum[-1])} for v in np.linspace(0,1,11)]})
        report['targets'][target]={'default':freeze['chosen'][target],'rows':rows,'groups':groups,'samples':samples,'curves':curves}
    return report

def export(report):
    raw=(json.dumps(report,ensure_ascii=False,sort_keys=True,allow_nan=False)+'\n').encode();digest=sha(raw);folder=ROOT/'apps/web/uplift-results'/digest[:16];folder.mkdir(parents=True,exist_ok=True);(folder/'case.json').write_bytes(raw)
    write(folder.parent/'manifest.json',{'schema':1,'run_id':P['id'],'path':digest[:16]+'/case.json','sha256':digest})
    write(ROOT/'artifacts/uplift-latest.json',{'run_id':P['id'],'source_sha256':report['source_sha256'],'report_sha256':digest})
def verify_saved_models(frame):
    """Recompute predictions and validation selection from frozen models, never fit again."""
    split=json.loads((STORE/'split.json').read_text())
    all_t=frame.segment.map({v:i for i,v in enumerate(P['arms'])}).to_numpy()
    tr,rest=train_test_split(np.arange(len(frame)),test_size=.4,random_state=P['seed'],stratify=all_t)
    va,te=train_test_split(rest,test_size=.5,random_state=P['seed']+1,stratify=all_t[rest])
    for key,expected in [('train',tr),('validation',np.sort(va)),('test',np.sort(te))]:
        np.testing.assert_array_equal(split[key],expected)
    saved=np.load(STORE/'predictions.npz');models=joblib.load(STORE/'models.joblib')
    freeze=json.loads((STORE/'frozen.json').read_text())
    for part in ['validation','test']:
        ids=np.asarray(split[part]);rows=frame.iloc[ids]
        x=np.c_[rows[models['num']].to_numpy(float),models['encoder'].transform(rows[['zip_code','channel']])]
        if part=='test':
            np.testing.assert_array_equal(saved['ids'],ids)
            np.testing.assert_array_equal(saved['t'],all_t[ids])
            np.testing.assert_array_equal(saved['y'],rows[P['outcomes']].to_numpy())
        for target in P['outcomes']:
            ms=models[target]
            mu=np.stack([predict(m,x) for m in ms['t']],axis=1)
            s_mu=np.stack([predict(ms['s'],np.c_[x,np.tile(np.eye(3)[a],(len(x),1))]) for a in range(3)],axis=1)
            scores={'s':s_mu[:,1:]-s_mu[:,[0]],'t':mu[:,1:]-mu[:,[0]],'response':mu[:,1:],
                    'history':history_scores(rows),'random':np.zeros((len(x),2))}
            scores['x']=np.stack([.5*predict(pair[0],x)+.5*predict(pair[1],x) for pair in ms['x']],axis=1)
            scores['r']=np.stack([predict(m['tau'],x) for m in ms['r']],axis=1)
            scores['linear_dml']=np.stack([m['tau'].predict(np.c_[np.ones(len(x)),m['scaler'].transform(x)]) for m in ms['linear_dml']],axis=1)
            if part=='test':
                for name,values in scores.items():np.testing.assert_allclose(values,saved[target+'__'+name],rtol=1e-10,atol=1e-10)
            else:
                base=contributions(all_t[ids],rows[target].to_numpy(),policy(scores['response'],.3))
                values={m:float(np.mean(contributions(all_t[ids],rows[target].to_numpy(),policy(scores[m],.3))-base)) for m in MODELS}
                for m,v in values.items():np.testing.assert_allclose(v,freeze['validation_scores'][target][m],rtol=1e-10,atol=1e-10)
                if max(MODELS,key=values.get)!=freeze['chosen'][target]:raise ValueError('Frozen selection mismatch')

def verify():
    frame=prepare();verify_saved_models(frame);fresh=report_from_saved(frame);old=json.loads((STORE/'report.json').read_text())
    if fresh!=old:raise ValueError('Saved evaluation differs from recomputed evidence')
    export(fresh);print('All policy estimates, paired intervals, curves and samples verified without retraining')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['run','verify','prepare']);args=parser.parse_args()
    {'run':run,'verify':verify,'prepare':prepare}[args.command]()

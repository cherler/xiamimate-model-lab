"""Past-only empirical prediction intervals and retrospective rolling stability."""
import json
import math
import time
import numpy as np
from .coverage_common import start,seal,publish_pointer,checked
from .m5_data import ROOT,digest,load,revenue_at,write
from .m5_run import train_predict,data_manifest
from .m5_features import baselines
from .m5_metrics import WRMSSE


def point_metrics(y,p):
    y=np.asarray(y,dtype=float);p=np.asarray(p,dtype=float);total=float(y.sum())
    return {'n':int(y.size),'mae':float(np.abs(y-p).mean()) if y.size else None,
            'wape':float(np.abs(y-p).sum()/total) if total else None,'bias':float((p-y).sum()/total) if total else None}

def interval_metrics(y,lo,hi,coverage):
    y,lo,hi=[np.asarray(v,dtype=float) for v in (y,lo,hi)]
    if y.shape!=lo.shape or y.shape!=hi.shape or not np.isfinite([y,lo,hi]).all() or (lo<0).any() or (hi<lo).any():raise ValueError('invalid interval')
    if not y.size:return {'n':0,'coverage':None,'width':None,'interval_score':None,'below':None,'above':None}
    alpha=1-coverage;score=hi-lo+2/alpha*np.maximum(lo-y,0)+2/alpha*np.maximum(y-hi,0)
    return {'n':int(y.size),'coverage':float(((y>=lo)&(y<=hi)).mean()),'width':float((hi-lo).mean()),
            'interval_score':float(score.mean()),'below':float((y<lo).mean()),'above':float((y>hi).mean())}

def empirical_quantile(values,coverage):
    v=np.asarray(values,dtype=float).ravel();rank=math.ceil((len(v)+1)*coverage)
    if not 0<coverage<1 or rank>len(v) or rank<1 or not np.isfinite(v).all():raise ValueError('insufficient finite calibration residuals')
    return float(np.partition(v,rank-1)[rank-1])

def past_only(previous,origin,horizon=28):
    if not previous or any(p['origin']+horizon>origin for p in previous):raise ValueError('calibration overlaps forecast')


def make_bounds(previous,current,model,coverage,categories):
    past_only(previous,current['origin']);p=current['predictions'][model];radius=np.zeros_like(p,dtype=float);quantiles={}
    for cat in sorted(set(categories)):
        mask=categories==cat
        for week in range(4):
            sl=slice(week*7,(week+1)*7)
            residual=np.concatenate([(np.abs(v['actual'][mask,sl]-v['predictions'][model][mask,sl])/v['scale'][mask,None]).ravel() for v in previous])
            q=empirical_quantile(residual,coverage);radius[mask,sl]=current['scale'][mask,None]*q
            quantiles[f'{cat}/week{week+1}']={'q':q,'n':len(residual)}
    return np.maximum(0,p-radius),p+radius,quantiles


def group_indices(categories,sparse):
    return {'all_items':np.ones(len(categories),dtype=bool),**{str(c):categories==c for c in sorted(set(categories))},
            'sparse_history':sparse,'dense_history':~sparse}


def build_report(folds,metadata,cfg):
    cat=metadata.cat_id.to_numpy();windows=[];saved={};calibration={}
    for i,fold in enumerate(folds):
        o=fold['origin'];y=fold['actual'];groups=group_indices(cat,fold['sparse']);out={'origin':o,'dates':fold['dates'],'calibration_origins':[v['origin'] for v in folds[:i]],'models':{}}
        saved[f'actual_{o}']=y
        for model in cfg['models']:
            p=fold['predictions'][model];saved[f'{model}_{o}']=p
            m={'point':point_metrics(y,p),'scope_wrmsse':fold['scores'][model]['scope_wrmsse'],
               'groups':{k:point_metrics(y[mask],p[mask]) for k,mask in groups.items()},
               'weeks':[point_metrics(y[:,w*7:(w+1)*7],p[:,w*7:(w+1)*7]) for w in range(4)],'intervals':{}}
            if i:
                for coverage in cfg['levels']:
                    label=str(int(coverage*100));lo,hi,qs=make_bounds(folds[:i],fold,model,coverage,cat)
                    calibration[f'{o}/{model}/{label}']=qs
                    saved[f'lower_{model}_{o}_{label}']=lo;saved[f'upper_{model}_{o}_{label}']=hi
                    aggregates={}
                    for key,mask in {'store':groups['all_items'],**{str(c):groups[str(c)] for c in sorted(set(cat))}}.items():
                        yy=y[mask].sum(axis=0);pp=p[mask].sum(axis=0)
                        residual=np.concatenate([np.abs(v['actual'][mask].sum(axis=0)-v['predictions'][model][mask].sum(axis=0)) for v in folds[:i]])
                        q=empirical_quantile(residual,coverage);ll=np.maximum(0,pp-q);hh=pp+q
                        aggregates[key]={'actual':yy.tolist(),'prediction':pp.tolist(),'lower':ll.tolist(),'upper':hh.tolist(),
                            'metrics':interval_metrics(yy,ll,hh,coverage),'calibration_n':len(residual),'radius':q}
                    m['intervals'][label]={'metrics':interval_metrics(y,lo,hi,coverage),
                        'groups':{k:interval_metrics(y[mask],lo[mask],hi[mask],coverage) for k,mask in groups.items()},
                        'weeks':[interval_metrics(y[:,w*7:(w+1)*7],lo[:,w*7:(w+1)*7],hi[:,w*7:(w+1)*7],coverage) for w in range(4)],'aggregates':aggregates}
            out['models'][model]=m
        windows.append(out)
    return windows,saved,calibration


def run():
    tick=time.perf_counter();folder,protocol,base,base_report=start('m5');cfg=protocol['m5'];config=base_report['config']
    # Match original feature/training implementations and raw input hashes; do not inspect reserved outcomes.
    inputs=json.loads((base/'inputs.json').read_text())
    if data_manifest()!=inputs['data']:raise ValueError('M5 source drift')
    for name in ['m5_features.py','m5_run.py','m5_data.py']:
        if digest(__import__('pathlib').Path(__file__).with_name(name))!=inputs['source'][f'services/competitions/{name}']:raise ValueError('training source drift')
    write(folder/'inputs.json',inputs['data'])
    meta,sales,calendar,prices=load('CA_1',cfg['max_label_day']);meta.to_csv(folder/'cohort.csv',index=False)
    if max(cfg['origins'])+28>1913:raise ValueError('reserved window forbidden')
    folds=[];costs={}
    for o in cfg['origins']:
        history=sales[:,:o];actual=sales[:,o:o+28]
        if o in config['validation_origins']:
            with np.load(base/f'predictions-{o}.npz') as bundle:
                if not np.array_equal(bundle['actual'],actual):raise ValueError('saved actual mismatch')
                predictions={m:bundle[m] for m in cfg['models']}
            costs[str(o)]={'reused':True}
        else:
            predictions={'weekday_mean_8w':baselines(history)['weekday_mean_8w']}
            predictions['lgbm_tweedie_core'],cost=train_predict(folder,config,meta,history,calendar,prices,o)
            costs[str(o)]={'reused':False,**cost}
        evaluator=WRMSSE(meta,history,revenue_at(history,prices,o))
        fold={'origin':o,'actual':actual,'predictions':predictions,'scale':np.sqrt(1+history[:,-56:].mean(axis=1,dtype=float)),
            'sparse':(history[:,-56:]==0).mean(axis=1)>=.5,'dates':calendar.date.iloc[o:o+28].tolist(),
            'scores':{m:evaluator.score(actual,p) for m,p in predictions.items()}}
        folds.append(fold)
        np.savez_compressed(folder/f'fold-{o}.npz',actual=actual,scale=fold['scale'],sparse=fold['sparse'],**predictions)
        write(folder/f'fold-{o}.json',{'origin':o,'dates':fold['dates'],'scores':fold['scores']})
        print(f'Saved forecast origin {o}',flush=True)
    windows,saved,calibration=build_report(folds,meta,cfg)
    write(folder/'calibration.json',calibration);np.savez_compressed(folder/'intervals.npz',**saved)
    report={'run_id':folder.name,'base_run_id':base.name,'status':'complete_development','public_export_allowed':False,
        'protocol':protocol,'windows':windows,'costs':costs,'total_seconds':time.perf_counter()-tick,
        'method':'Past-only scaled absolute residual intervals; empirical retrospective coverage, not a finite-sample temporal guarantee.'}
    seal(folder,report);verify(folder);publish_pointer('m5',folder);print(folder.name,flush=True)


def verify(folder):
    import pandas as pd
    r=checked(folder);cfg=r['protocol']['m5'];meta=pd.read_csv(folder/'cohort.csv');folds=[]
    if cfg['origins']!=[1801,1829,1857,1885] or cfg['max_label_day']!=1913:raise ValueError('invalid development boundary')
    for o in cfg['origins']:
        with np.load(folder/f'fold-{o}.npz') as b:
            f=json.loads((folder/f'fold-{o}.json').read_text())
            folds.append({**f,'actual':b['actual'],'scale':b['scale'],'sparse':b['sparse'],'predictions':{m:b[m] for m in cfg['models']}})
    windows,saved,calibration=build_report(folds,meta,cfg)
    if windows!=r['windows'] or calibration!=json.loads((folder/'calibration.json').read_text()):raise ValueError('interval report mismatch')
    with np.load(folder/'intervals.npz') as b:
        if set(saved)!=set(b.files) or any(not np.array_equal(v,b[k]) for k,v in saved.items()):raise ValueError('saved bounds mismatch')
    return r

if __name__=='__main__':run()

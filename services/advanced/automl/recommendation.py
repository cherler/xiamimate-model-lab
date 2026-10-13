"""Compare fixed families and feature subsets on exactly the same ranking queries."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2');os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
if sys.argv[-1].endswith('-graph'):
    import torch
import gzip
import json
import pickle
import time
import numpy as np
from lightgbm import LGBMRanker,Booster
from common import write,ROOT
from ranking import evaluate,FEATURES
from automl.features import REC_GROUPS,REC_NAMES


def fit(id,bundle,spec,directory,refit=False):
    s=bundle['snapshot'];config=spec['config'];params=spec['fixed_parameters'];directory.mkdir(exist_ok=True,parents=True)
    start=time.perf_counter();metadata={}
    if id in ('decay','itemcf'):
        column=2 if id=='decay' else 3;score=lambda q:q['features'][:,column];features=[FEATURES[column]];family=id
    elif id=='ease':
        from scipy import linalg
        gram=(s['x'].T@s['x']).toarray().astype(float);gram.flat[::len(gram)+1]+=spec['base']['recommendation']['ease_regularization']
        precision=linalg.solve(gram,np.eye(len(gram)),assume_a='pos',check_finite=False);weights=-precision/np.diag(precision)[None,:];np.fill_diagonal(weights,0);np.save(directory/'weights.npy',weights)
        score=lambda q:(s['x'].getrow(s['ui'][q['customer']])@weights).ravel()[q['ids']];features=['user_item_interactions'];family='EASE'
    elif id=='lightgcn':
        from graph import fit_graph
        import torch
        p=params['lightgcn'];model,users,items,trace=fit_graph(s['x'],{**p['params'],'epochs':p['attrs']['best_epoch']},config['seed'],config['threads'])
        torch.save(model.state_dict(),directory/'model.pt');np.savez_compressed(directory/'embeddings.npz',users=users,items=items);write(directory/'loss.json',trace)
        score=lambda q:items[q['ids']]@users[s['ui'][q['customer']]];features=['user_item_interactions'];family='LightGCN';metadata['epochs']=p['attrs']['best_epoch']
    else:
        group=id.removeprefix('rank_');columns=REC_GROUPS[group];queries=bundle['training']+(bundle['queries'] if refit else [])
        p=params['lightgbm'];kwargs={**p['params'],'n_estimators':p['attrs']['best_epoch']}
        m=LGBMRanker(objective='lambdarank',metric='None',random_state=config['seed'],n_jobs=config['threads'],verbosity=-1,deterministic=True,force_col_wise=True,**kwargs)
        x=np.vstack([q['features'][:,columns] for q in queries]);y=np.concatenate([q['labels'] for q in queries]);features=[FEATURES[i] for i in columns]
        m.fit(x,y,group=[len(q['ids']) for q in queries],feature_name=features);m.booster_.save_model(str(directory/'model.txt'));loaded=Booster(model_file=str(directory/'model.txt'))
        np.testing.assert_allclose(m.booster_.predict(x[:100],num_threads=2),loaded.predict(x[:100],num_threads=2),atol=1e-10)
        score=lambda q:loaded.predict(q['features'][:,columns],num_threads=config['threads']);family='LightGBM';metadata.update(feature_group=group,feature_group_label=REC_NAMES[group],trees=kwargs['n_estimators'])
    return score,time.perf_counter()-start,dict(family=family,features=features,**metadata)


def main(run,phase):
    spec=json.loads((run/'config.json').read_text());phase,family=phase.split('-');accept=lambda id:(id=='lightgcn')==(family=='graph')
    with (run/'recommendation-inputs.pkl').open('rb') as f:bundle=pickle.load(f)
    if phase=='validation':
        results=[]
        for id in filter(accept,spec['config']['recommendation_candidates']):
            print('Validation recommendation',id,flush=True);d=run/'models'/id
            try:
                score,seconds,info=fit(id,bundle,spec,d);t=time.perf_counter();metrics,rows=evaluate(bundle['snapshot'],bundle['queries'],score);inference=time.perf_counter()-t
                write(d/'validation.json',rows);results.append(dict(id=id,state='COMPLETE',split='validation',task='recommendation',value=metrics['ndcg'],metrics=metrics,training_seconds=seconds,scoring_seconds=inference,cost_seconds=seconds+inference,**info))
            except Exception as e:
                results.append(dict(id=id,state='FAIL',split='validation',task='recommendation',failure=f'{type(e).__name__}: {e}'))
            write(run/f'recommendation-{family}-progress.json',results)
        write(run/f'recommendation-{family}-candidates.json',results)
    else:
        selection=json.loads((run/'selection.json').read_text())['recommendation'];chosen=sorted(filter(accept,{selection['accuracy'],selection['efficient']}));results={id:[] for id in chosen}
        parent=ROOT/'artifacts/advanced-runs'/spec['parents']['ranking']['run'];fixed={}
        for id in chosen:
            if id.startswith('rank_'):fixed[id]=fit(id,bundle,spec,run/'replay-models'/id,refit=True)[0]
        for origin in spec['base']['recommendation']['evaluation_origins']:
            with gzip.open(parent/f'snapshot-{origin}.pkl.gz','rb') as f:b=pickle.load(f)
            for id in chosen:
                if id in fixed:score=fixed[id]
                else:score=fit(id,b,spec,run/'replay-models'/f'{id}-{origin}')[0]
                metrics,rows=evaluate(b['snapshot'],b['queries'],score);write(run/f'rec-replay-{id}-{origin}.json',rows)
                results[id].append(dict(origin=origin,metrics=metrics,catalog=len(b['snapshot']['items'])))
        write(run/f'recommendation-{family}-replay.json',{id:dict(windows=windows,aggregate={k:float(np.mean([w['metrics'][k] for w in windows])) for k in ['recall','ndcg','hit_rate','catalog_coverage','candidate_recall']}) for id,windows in results.items()})
if __name__=='__main__':main(Path(sys.argv[1]),sys.argv[2])

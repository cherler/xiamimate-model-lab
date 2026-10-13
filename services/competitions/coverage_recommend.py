"""Fixed-cohort retrieval expansion, with fresh rankers and frozen original replay."""
from collections import Counter
import json
import time
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
import lightgbm as lgb
from .coverage_common import start,seal,publish_pointer,checked
from .m5_data import ROOT,digest,write
from .dressipi import SessionBaselines,temporal_split,validate_tables
from .dressipi_run import FEATURES,stable_sample,queries
from .dressipi_study import summarize


class RetrievalEngine:
    def __init__(self,model,catalogue):
        self.model=model;self.items=sorted(catalogue);self.index={v:i for i,v in enumerate(self.items)}
        attrs=sorted(model.attribute_items);mapping={v:i for i,v in enumerate(attrs)}
        rows=[];cols=[]
        for i,item in enumerate(self.items):
            for a in model.attributes[item]:rows.append(i);cols.append(mapping[a])
        self.matrix=csr_matrix((np.ones(len(rows)),(rows,cols)),shape=(len(self.items),len(attrs)))
        self.count=np.asarray(self.matrix.sum(axis=1)).ravel()
        df=np.asarray(self.matrix.sum(axis=0)).ravel();self.idf=np.log((1+len(self.items))/(1+df))+1
        self.mass=np.asarray(self.matrix@self.idf).ravel()
        self.pop=np.asarray([model.popularity[v] for v in self.items],dtype=float)

    def signals(self,sequence):
        n=len(self.items);co=np.zeros(n);attr=np.zeros(n);idf=np.zeros(n);shared_cache={}
        for age,item in enumerate(reversed(sequence)):
            pos=self.index[item];weight=.8**age
            if item not in shared_cache:
                row=self.matrix.getrow(pos);common=(self.matrix@row.T).toarray().ravel()
                weighted=(self.matrix@row.multiply(self.idf).T).toarray().ravel()
                shared_cache[item]=(common,weighted)
            common,weighted=shared_cache[item]
            attr+=weight*np.divide(common,self.count[pos]+self.count-common,out=np.zeros(n),where=(self.count[pos]+self.count-common)>0)
            idf+=weight*np.divide(weighted,self.mass[pos]+self.mass-weighted,out=np.zeros(n),where=(self.mass[pos]+self.mass-weighted)>0)
            links=self.model.links.get(item,{});den=sum(links.values()) or 1
            for target,count in links.items():co[self.index[target]]+=weight*count/den
        available=np.ones(n,dtype=bool);available[[self.index[v] for v in sequence]]=False
        indices=np.flatnonzero(available)
        rank=lambda score:indices[np.lexsort((indices,-self.pop[indices],-score[indices]))]
        shared=shared_cache[sequence[-1]][0]
        matched=sum((v[0]>0).astype(int) for v in shared_cache.values())
        x=np.column_stack([np.log1p(self.pop),co,attr,np.zeros((n,3)),shared,
            np.divide(shared,self.count[self.index[sequence[-1]]]+self.count-shared,out=np.zeros(n),where=(self.count[self.index[sequence[-1]]]+self.count-shared)>0),
            self.count,np.full(n,len(sequence)),np.full(n,len(set(sequence))),matched]).astype('float32')
        channels={'popularity':rank(np.zeros(n)),'cooccurrence':rank(co),'attributes':rank(attr),'idf':rank(idf)}
        return x,channels

    def candidates(self,x,channels,topk,idf_k=0):
        base=['popularity','cooccurrence','attributes'];indices=np.unique(np.concatenate([channels[k][:topk] for k in base]+([channels['idf'][:idf_k]] if idf_k else [])))
        features=x[indices].copy()
        for j,k in enumerate(base):
            ranks=np.full(len(self.items),topk+1,dtype='float32');ranks[channels[k][:topk]]=np.arange(1,topk+1)
            features[:,3+j]=ranks[indices]
        return [self.items[i] for i in indices],features


def score(rows,key,originals):
    m=summarize(rows,key);pools=[len(r['pool']) for r in rows]
    m.update(candidate_mean=float(np.mean(pools)),candidate_p95=float(np.percentile(pools,95)),candidate_max=max(pools))
    m['newly_retrieved']=sum(r['target'] in r['pool'] and o['target'] not in o['pool'] for r,o in zip(rows,originals))
    m['lost_retrieval']=sum(r['target'] not in r['pool'] and o['target'] in o['pool'] for r,o in zip(rows,originals))
    return m


def run():
    started=time.perf_counter();folder,protocol,base,r=start('dressipi');cfg=protocol['dressipi'];raw=ROOT/'data/raw/dressipi'
    for name,sha in r['inputs'].items():
        if digest(raw/name)!=sha:raise ValueError('Dressipi source changed')
    for name,sha in r['code'].items():
        if digest(__import__('pathlib').Path(__file__).with_name(name))!=sha:raise ValueError('original pipeline changed')
    write(folder/'inputs.json',r['inputs'])
    views,targets,attrs=[pd.read_csv(raw/n,dtype=str) for n in ['train_sessions.csv','train_purchases.csv','item_features.csv']]
    validate_tables(views,targets,attrs);p=r['protocol']
    bv,bp,tv,tp=temporal_split(views,targets,p['base_before'],p['ranking_before'])
    _,_,vv,vp=temporal_split(views,targets,p['ranking_before'],p['validation_end_exclusive'])
    ids=stable_sample(bv.session_id,cfg['base_sessions']);bv=bv[bv.session_id.isin(ids)];bp=bp[bp.session_id.isin(ids)]
    model=SessionBaselines().fit(bv,bp,attrs);engine=RetrievalEngine(model,attrs.item_id.unique())
    train=queries(tv,tp,cfg['train_sessions']);valid=queries(vv,vp,cfg['validation_sessions']);originals=json.loads((base/'predictions.json').read_text())
    if [(s,t) for s,seq,t in valid]!=[(v['session'],v['target']) for v in originals]:raise ValueError('validation cohort changed')
    del views,targets,attrs,bv,bp,tv,tp,vv,vp
    variants={k:v for k,v in cfg['variants'].items() if k!='original'};data={k:{'x':[],'y':[],'groups':[],'queries':[]} for k in variants}
    prep=time.perf_counter()
    for i,(sid,seq,target) in enumerate(train):
        x,channels=engine.signals(seq)
        for key,config in variants.items():
            pool,features=engine.candidates(x,channels,**config);fitted=target in pool;d=data[key]
            d['queries'].append({'session':sid,'target':target,'pool':pool,'fitted':fitted})
            if fitted:d['x'].append(features);d['y'].append(np.asarray([int(v==target) for v in pool],dtype='int8'));d['groups'].append(len(pool))
        if (i+1)%500==0:print(f'Prepared {i+1}/{len(train)} expanded training queries',flush=True)
    costs={};boosters={};fitted_counts={};shared_prep=time.perf_counter()-prep
    for key,d in data.items():
        x=np.concatenate(d['x']);y=np.concatenate(d['y']);d['x']=[];d['y']=[]
        np.savez_compressed(folder/f'train-{key}.npz',x=x,y=y,groups=d['groups']);write(folder/f'queries-{key}.json',d['queries']);d['queries']=[]
        tick=time.perf_counter();ranker=lgb.LGBMRanker(**p['params']);ranker.fit(x,y,group=d['groups'],feature_name=FEATURES)
        costs[key]={'fit_seconds':time.perf_counter()-tick};fitted_counts[key]=len(d['groups']);boosters[key]=ranker.booster_;boosters[key].save_model(str(folder/f'{key}.txt'))
        del x,y
    write(folder/'frozen.json',{'protocol_sha256':digest(folder/'protocol.json'),'params':p['params'],
        'models':{k:digest(folder/f'{k}.txt') for k in variants},'training':{k:digest(folder/f'train-{k}.npz') for k in variants}})
    rows={k:[] for k in cfg['variants']};samples={k:[] for k in cfg['variants']};cold=[];tick=time.perf_counter()
    for i,((sid,seq,target),original) in enumerate(zip(valid,originals)):
        x,channels=engine.signals(seq);origpool,origx=engine.candidates(x,channels,100)
        if origpool!=original['pool'] or any([engine.items[j] for j in channels[k][:100]]!=original['rankings'][k] for k in ['popularity','cooccurrence','attributes']):raise ValueError('accelerated retrieval differs from original')
        cold.append({'session':sid,'zero_base_purchases':model.popularity[target]==0})
        for key,config in cfg['variants'].items():
            if key=='original':pool=origpool;ranking=original['rankings']['lightgbm']
            else:
                pool,features=engine.candidates(x,channels,**config);pred=boosters[key].predict(features,num_threads=2)
                ranking=[pool[j] for j in sorted(range(len(pool)),key=lambda j:(-pred[j],pool[j]))[:100]]
            row={'session':sid,'target':target,'pool':pool,'rankings':{key:ranking}};rows[key].append(row)
            if i<12:
                shown=set(seq)|{target}|set(ranking[:10]);samples[key].append({'session':sid,'sequence':seq,'target':target,'pool_size':len(pool),'target_retrieved':target in pool,'ranking':ranking,
                    'attributes':{v:[list(a) for a in sorted(model.attributes[v])] for v in sorted(shown)}})
        if (i+1)%250==0:print(f'Evaluated {i+1}/{len(valid)} fixed sessions',flush=True)
    summary={k:score(v,k,originals) for k,v in rows.items()}
    groups={k:{'zero_base_purchases':summarize([v for v,c in zip(row,cold) if c['zero_base_purchases']],k),'seen_base_purchases':summarize([v for v,c in zip(row,cold) if not c['zero_base_purchases']],k)} for k,row in rows.items()}
    write(folder/'predictions.json',rows);write(folder/'samples.json',samples);write(folder/'groups.json',cold)
    report={'run_id':folder.name,'base_run_id':base.name,'status':'complete_development','public_export_allowed':False,
        'protocol':protocol,'models':summary,'groups':groups,'fitted_queries':{'original':r['cohort']['ranking_fitted_queries'],**fitted_counts},
        'cost':{'shared_training_preparation_seconds':shared_prep,'fits':costs,'validation_all_variants_seconds':time.perf_counter()-tick,'total_seconds':time.perf_counter()-started},
        'params':p['params'],'features':FEATURES,'original_retrieval_exact':True,
        'note':'Candidate capacity and training-positive coverage both change. End-to-end development comparison; not a controlled ranking feature ablation. Rank missing sentinel is topk+1.'}
    seal(folder,report);verify(folder,base);publish_pointer('dressipi',folder);print(json.dumps(summary,indent=2),flush=True)


def verify(folder,base):
    r=checked(folder);originals=json.loads((base/'predictions.json').read_text());rows=json.loads((folder/'predictions.json').read_text());groups=json.loads((folder/'groups.json').read_text())
    if r['base_run_id']!=base.name or r['public_export_allowed'] is not False:raise ValueError('coverage identity mismatch')
    if len(groups)!=len(originals) or [g['session'] for g in groups]!=[v['session'] for v in originals]:raise ValueError('group alignment changed')
    frozen=json.loads((folder/'frozen.json').read_text())
    if frozen['protocol_sha256']!=digest(folder/'protocol.json') or frozen['params']!=r['params']:raise ValueError('frozen protocol changed')
    for k,sha in frozen['models'].items():
        if sha!=digest(folder/f'{k}.txt') or frozen['training'][k]!=digest(folder/f'train-{k}.npz'):raise ValueError('frozen model changed')
    samples=json.loads((folder/'samples.json').read_text())
    for key,records in rows.items():
        if len(records)!=len(originals):raise ValueError('cohort count drift')
        for row,orig in zip(records,originals):
            if (row['session'],row['target'])!=(orig['session'],orig['target']):raise ValueError('cohort drift')
            if not set(orig['pool']).issubset(row['pool']):raise ValueError('lost original candidates')
            if key=='original' and (row['pool']!=orig['pool'] or row['rankings'][key]!=orig['rankings']['lightgbm']):raise ValueError('original changed')
        if score(records,key,originals)!=r['models'][key]:raise ValueError('coverage metric mismatch')
        fresh={'zero_base_purchases':summarize([v for v,c in zip(records,groups) if c['zero_base_purchases']],key),'seen_base_purchases':summarize([v for v,c in zip(records,groups) if not c['zero_base_purchases']],key)}
        if fresh!=r['groups'][key]:raise ValueError('group score mismatch')
        for s,v in zip(samples[key],records[:12]):
            if s['session']!=v['session'] or s['target']!=v['target'] or s['ranking']!=v['rankings'][key] or s['pool_size']!=len(v['pool']) or s['target_retrieved']!=(v['target'] in v['pool']):raise ValueError('sample changed')
    return r

if __name__=='__main__':run()

"""Past-only attributes and LambdaRank ablations on a fixed retrieval pool."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2')
os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
from pathlib import Path
import gzip
import json
import pickle
import time
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
from lightgbm import LGBMRanker, Booster
from common import CONFIG, ROOT, finish, load_data, new_run, rank_metrics, stable_users, write

WORDS=['bag','mug','candle','heart','vintage','christmas','red','blue','pink','white','glass','metal']
BEHAVIOR=['log_frequency','age_scaled','decay','itemcf','log_popularity','log_user_orders','log_user_items']
ATTRIBUTES=['log_item_price','price_iqr','name_words',*[f'name_has_{w}' for w in WORDS]]
CROSSES=['price_distance','text_affinity','keyword_affinity','user_price_available']
FEATURES=BEHAVIOR+ATTRIBUTES+CROSSES
GROUPS={'behavior':len(BEHAVIOR),'attributes':len(BEHAVIOR)+len(ATTRIBUTES),'cross':len(FEATURES)}

def build_snapshot(data,origin,cfg):
    origin=pd.Timestamp(origin)
    past=data[(data.date>=pd.Timestamp(cfg['history_start']))&(data.date<origin)&data.customer.notna()].copy()
    counts=past.groupby('item').customer.nunique()
    ranked=counts[counts>=2].reset_index(name='support').sort_values(['support','item'],ascending=[False,True])
    items=sorted(ranked.head(cfg['max_items']).item.tolist());ii={x:i for i,x in enumerate(items)}
    users=sorted(past.customer.unique().tolist());ui={u:i for i,u in enumerate(users)}
    known=past[past.item.isin(items)].copy()
    events=known.drop_duplicates(['customer','invoice','item'])
    rows=events.customer.map(ui).to_numpy();cols=events.item.map(ii).to_numpy();age=(origin-events.date).dt.total_seconds().to_numpy()/86400
    x=sparse.csr_matrix((np.ones(len(events)),(rows,cols)),shape=(len(users),len(items)));frequency=x.copy();x.data[:]=1
    decay=sparse.csr_matrix((np.exp(-age/90),(rows,cols)),shape=x.shape)
    pop=np.asarray(x.sum(axis=0)).ravel();co=(x.T@x).tocoo();sim=sparse.csr_matrix((co.data/(np.sqrt(pop[co.row]*pop[co.col])+1e-12)*co.data/(co.data+10),(co.row,co.col)),shape=(len(items),len(items)))
    sim.setdiag(0);sim.eliminate_zeros()
    ri=[];ci=[];values=[]
    for i in range(len(items)):
        a,b=sim.indptr[i:i+2];idx=sim.indices[a:b];v=sim.data[a:b];keep=np.lexsort((idx,-v))[:64]
        ri.extend([i]*len(keep));ci.extend(idx[keep]);values.extend(v[keep])
    sim=sparse.csr_matrix((values,(ri,ci)),shape=sim.shape)
    meta=known.sort_values(['date','invoice'],kind='stable').drop_duplicates('item',keep='last').set_index('item').reindex(items)
    names=meta['name'].fillna('').astype(str).tolist()
    prices=known.groupby('item').price.median().reindex(items).to_numpy()
    iqr=(known.groupby('item').price.quantile(.75)-known.groupby('item').price.quantile(.25)).reindex(items).to_numpy()
    keyword=np.array([[float(word in name.lower().split()) for word in WORDS] for name in names])
    attrs=np.column_stack([np.log1p(prices),np.log1p(iqr),[len(n.split())/10 for n in names],keyword])
    text=TfidfVectorizer(max_features=2048,stop_words='english',dtype=np.float32).fit_transform([n or 'unknown' for n in names])
    profiles=normalize(x@text,norm='l2');keyword_profiles=np.asarray(x@keyword)/np.maximum(1,np.asarray(x.sum(axis=1)))
    last=events.groupby(['customer','item']).date.max()
    ages={(str(u),str(item)):(origin-d).total_seconds()/86400 for (u,item),d in last.items()}
    up=past.groupby('customer').price.median().to_dict();orders=past.groupby('customer').invoice.nunique().to_dict();histories=past.groupby('customer').item.agg(lambda s:sorted(set(s))).to_dict()
    return {'origin':str(origin.date()),'items':items,'users':users,'ui':ui,'x':x,'frequency':frequency,'decay':decay,'pop':pop,'sim':sim,'attrs':attrs,'text':text,'profiles':profiles,'keyword_profiles':keyword_profiles,'keyword':keyword,'ages':ages,'user_prices':up,'orders':orders,'histories':histories,'names':names,'prices':prices,'max_input_date':str(past.date.max())}

def candidates_features(snapshot,user,cfg):
    s=snapshot;i=s['ui'][user];frequency=s['frequency'].getrow(i).toarray().ravel();decay=s['decay'].getrow(i).toarray().ravel();cf=(s['x'].getrow(i)@s['sim']).toarray().ravel()
    ids=set()
    for name,score in [('decay',decay),('itemcf',cf),('popular',s['pop'])]:
        ordered=np.argsort(-score,kind='stable')
        if name!='popular':ordered=ordered[score[ordered]>0]
        ids.update(ordered[:cfg['candidate_sources'][name]].tolist())
    ids=np.array(sorted(ids),dtype=int);n=len(ids)
    behavior=np.column_stack([np.log1p(frequency[ids]),[min(366,s['ages'].get((user,s['items'][j]),366))/366 for j in ids],decay[ids],cf[ids],np.log1p(s['pop'][ids]),np.full(n,np.log1p(s['orders'].get(user,0))),np.full(n,np.log1p(len(s['histories'].get(user,[]))))])
    price=s['user_prices'].get(user);text=(s['text'][ids]@s['profiles'].getrow(i).T).toarray().ravel();kw=s['keyword'][ids]@s['keyword_profiles'][i]
    cross=np.column_stack([np.abs(np.log1p(s['prices'][ids])-np.log1p(price or 0)),text,kw,np.full(n,float(price is not None))])
    return ids,np.column_stack([behavior,s['attrs'][ids],cross]).astype(np.float32)

def future_targets(data,origin):
    start=pd.Timestamp(origin);end=start+pd.offsets.MonthBegin(1)
    future=data[(data.date>=start)&(data.date<end)&data.customer.notna()]
    first=future.groupby('customer').date.transform('min')
    return {str(u):set(rows.item) for u,rows in future[future.date==first].groupby('customer')}

def make_queries(data,snapshot,cfg):
    targets=future_targets(data,snapshot['origin']);selected=stable_users(snapshot['users'],cfg['sample_customers'])
    queries=[];unobserved=0
    for user in selected:
        if user not in targets:unobserved+=1;continue
        ids,features=candidates_features(snapshot,user,cfg)
        target=sorted(targets[user]);labels=np.isin(np.array(snapshot['items'])[ids],target).astype(int)
        queries.append({'customer':user,'ids':ids,'features':features,'labels':labels,'target':target})
    return queries,{'training_sample':len(selected),'returning':len(queries),'unobserved':unobserved}

def summarize(records,catalog):
    return {**{k:float(np.mean([r[k] for r in records])) for k in ['recall','ndcg','hit_rate']},'customers':len(records),'catalog_coverage':len({i for r in records for i in r['ranked']})/catalog,'candidate_recall':float(np.mean([r['candidate_recall'] for r in records]))}

def evaluate(snapshot,queries,scorer):
    records=[]
    for q in queries:
        score=np.asarray(scorer(q));order=np.argsort(-score,kind='stable')[:10];items=np.array(snapshot['items']);ranked=items[q['ids'][order]].tolist();target=set(q['target'])
        records.append({'customer':q['customer'],'ranked':ranked,'target':q['target'],'candidate_count':len(q['ids']),'candidate_recall':len(set(items[q['ids']])&target)/len(target),**rank_metrics(ranked,target)})
    return summarize(records,len(snapshot['items'])),records

def main():
    config=json.loads(CONFIG.read_text());cfg=config['recommendation'];data,source=load_data();run=new_run('ranking',config);start=time.perf_counter();training=[];groups=[]
    for origin in cfg['training_origins']:
        if pd.Timestamp(origin)+pd.offsets.MonthBegin(1)>pd.Timestamp(cfg['evaluation_origins'][0]):raise ValueError('Training label crosses evaluation origin')
        print('Build training snapshot',origin,flush=True);s=build_snapshot(data,origin,cfg);queries,_=make_queries(data,s,cfg)
        for q in queries:training.append(q);groups.append(len(q['ids']))
    x=np.vstack([q['features'] for q in training]);y=np.concatenate([q['labels'] for q in training]);models={};model_info={}
    for name,n in GROUPS.items():
        t=time.perf_counter();m=LGBMRanker(objective='lambdarank',random_state=config['seed'],n_jobs=config['threads'],verbosity=-1,deterministic=True,force_col_wise=True,**cfg['ranker'])
        m.fit(x[:,:n],y,group=groups,feature_name=FEATURES[:n]);m.booster_.save_model(str(run/f'{name}.txt'));loaded=Booster(model_file=str(run/f'{name}.txt'));err=float(np.abs(m.booster_.predict(x[:100,:n])-loaded.predict(x[:100,:n])).max());assert err<1e-10
        models[name]=loaded;model_info[name]={'features':FEATURES[:n],'training_seconds':time.perf_counter()-t,'reload_max_error':err,'feature_gain':dict(zip(FEATURES[:n],m.booster_.feature_importance(importance_type='gain').tolist()))}
    windows=[];samples=[]
    for origin in cfg['evaluation_origins']:
        print('Evaluate ranking',origin,flush=True);s=build_snapshot(data,origin,cfg);queries,cohort=make_queries(data,s,cfg)
        with gzip.open(run/f'snapshot-{origin}.pkl.gz','wb') as f:pickle.dump({'snapshot':s,'queries':queries,'cohort':cohort},f,protocol=5)
        summaries={};rows={}
        scores={'decay':lambda q:q['features'][:,2],'itemcf':lambda q:q['features'][:,3],**{name:(lambda q,n=n,m=models[name]:m.predict(q['features'][:,:n],num_threads=config['threads'])) for name,n in GROUPS.items()}}
        for name,scorer in scores.items():summaries[name],rows[name]=evaluate(s,queries,scorer)
        write(run/f'predictions-{origin}.json',rows)
        windows.append({'origin':origin,'catalog':len(s['items']),'max_input_date':s['max_input_date'],'cohort':cohort,'models':summaries})
        # Fixed training-user sample, no selection by hits or future performance.
        chosen=set(stable_users(s['users'],12))
        for idx,q in enumerate(queries):
            if q['customer'] not in chosen:continue
            ids=q['ids'];items=np.array(s['items']);featuremap={items[j]:{k:float(v) for k,v in zip(FEATURES,q['features'][kidx])} for kidx,j in enumerate(ids)}
            samples.append({'origin':origin,'customer':q['customer'],'history':s['histories'][q['customer']][-30:],'history_note':'按商品编号排列，最多展示30件，非时间顺序','target':q['target'],'models':{name:rows[name][idx] for name in rows},'features':featuremap,'names':dict(zip(s['items'],s['names']))})
    aggregate={name:{k:float(np.mean([w['models'][name][k] for w in windows])) for k in ['recall','ndcg','hit_rate','catalog_coverage','candidate_recall']} for name in windows[0]['models']}
    report={'source':source,'task':'next_basket_with_repeat','scope':'UK; training-only top 2000 catalog; fixed training-user hash sample; returning warm users only; equal-window means','feature_groups':GROUPS,'features':FEATURES,'models':model_info,'training_groups':len(groups),'training_rows':len(y),'training_groups_with_positive':sum(bool(q['labels'].sum()) for q in training),'windows':windows,'aggregate':aggregate,'duration_seconds':time.perf_counter()-start,'limitations':['Candidate set is fixed across rankers; missed retrieval targets stay in metric denominators.','Price is historical transaction unit price; name keywords are lexical attributes, not verified merchandise categories.','Only returning users from a pre-outcome sample are scored; no cold-start effectiveness claim.','No exposure labels; unpurchased candidates are unlabeled negatives, not observed dislikes.']}
    write(run/'samples.json',samples);finish(run,report,'ranking');print(run,flush=True)
if __name__=='__main__':main()

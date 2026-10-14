"""Frozen-protocol preference segmentation. New development run; preserve R5."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2')
os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
import hashlib
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
import igraph as ig
import leidenalg as la
import sklearn
from scipy import sparse
from sklearn.cluster import KMeans, HDBSCAN
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfTransformer
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import normalize
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from services.monitoring.common import load, save, sha
from services.monitoring.segments import rfm_at
CONFIG=Path(__file__).with_name('protocol.json')
METHODS=['rfm','kmeans','leiden','matched','hdbscan']


def historical(frame, origin, days):
    origin=pd.Timestamp(origin)
    return frame[(frame.date>=origin-pd.Timedelta(days=days))&(frame.date<origin)&frame.customer.notna()].copy()


def matrix(past, ids, catalog):
    ui={u:i for i,u in enumerate(ids)};ii={v:i for i,v in enumerate(catalog)}
    events=past[past.item.isin(catalog)].drop_duplicates(['customer','invoice','item'])
    return sparse.csr_matrix((np.ones(len(events)),(events.customer.map(ui),events.item.map(ii))),shape=(len(ids),len(catalog)))


def feature_fit(past, ids, cfg):
    support=past.groupby('item').customer.nunique()
    catalog=sorted(support[support>=cfg['min_item_customers']].index.tolist())
    x=matrix(past,ids,catalog)
    tfidf=TfidfTransformer(sublinear_tf=True);weighted=tfidf.fit_transform(x)
    svd=TruncatedSVD(n_components=min(cfg['svd_dimensions'],len(catalog)-1,len(ids)-1),random_state=cfg['seed'])
    z=normalize(svd.fit_transform(weighted))
    return {'catalog':catalog,'tfidf':tfidf,'svd':svd},x,z


def feature_transform(past, ids, fitted):
    x=matrix(past,ids,fitted['catalog'])
    return x,normalize(fitted['svd'].transform(fitted['tfidf'].transform(x)))


def graph_edges(z,k):
    n=len(z);k=min(k,n-1)
    distances,indices=NearestNeighbors(n_neighbors=k+1,metric='cosine',algorithm='brute',n_jobs=2).fit(z).kneighbors(z)
    edges={}
    for i,(ds,js) in enumerate(zip(distances,indices)):
        candidates=sorted([(int(j),max(0.,1-float(d))) for d,j in zip(ds,js) if j!=i],key=lambda t:(-t[1],t[0]))[:k]
        for j,w in candidates:
            if w<=1e-12:continue
            pair=tuple(sorted((i,j)));edges[pair]=max(edges.get(pair,0.),w)
    pairs=sorted(edges)
    return pairs,[edges[p] for p in pairs]


def graph_fit(z,cfg,seed,neighbors=None,resolution=None):
    edges,weights=graph_edges(z,neighbors or cfg['graph']['neighbors'])
    graph=ig.Graph(n=len(z),edges=edges,directed=False)
    partition=la.find_partition(graph,la.RBConfigurationVertexPartition,weights=weights,
        resolution_parameter=resolution if resolution is not None else cfg['graph']['resolution'],seed=seed,n_iterations=cfg['graph']['iterations'])
    return np.asarray(partition.membership),{'edges':edges,'weights':weights,'quality':float(partition.quality()),'components':len(graph.connected_components())}


def fit_methods(z,rfm_labels,cfg):
    tick=time.perf_counter();leiden,graph=graph_fit(z,cfg,cfg['seed']);times={'leiden':time.perf_counter()-tick}
    models={};labels={'rfm':np.asarray(rfm_labels),'leiden':leiden}
    for method,k in [('kmeans',cfg['kmeans']['n_clusters']),('matched',len(set(leiden)))]:
        tick=time.perf_counter();models[method]=KMeans(n_clusters=k,n_init=cfg['kmeans']['n_init'],random_state=cfg['seed']).fit(z)
        labels[method]=models[method].labels_;times[method]=time.perf_counter()-tick
    tick=time.perf_counter();models['hdbscan']=HDBSCAN(**cfg['hdbscan'],n_jobs=2).fit(z)
    labels['hdbscan']=models['hdbscan'].labels_;times['hdbscan']=time.perf_counter()-tick
    return labels,models,graph,times


def agreement(a,b):
    a=np.asarray(a);b=np.asarray(b);both=(a>=0)&(b>=0)
    return {'n':len(a),'ari_all':float(adjusted_rand_score(a,b)), 'jointly_assigned':int(both.sum()),
            'ari_assigned':float(adjusted_rand_score(a[both],b[both])) if both.sum()>=2 else None,
            'reference_unassigned':int((a<0).sum()),'alternative_unassigned':int((b<0).sum())}


def summary(labels,z,sample):
    assigned=labels>=0;sample=np.asarray(sample);sub=sample[assigned[sample]];groups=set(labels[sub]);sil=None
    if 1<len(groups)<len(sub):sil=float(silhouette_score(z[sub],labels[sub],metric='euclidean'))
    return {'groups':len(set(labels[assigned])),'assigned':int(assigned.sum()),'unassigned':int((~assigned).sum()),
        'silhouette':sil,'silhouette_n':len(sub),'silhouette_groups':len(groups)}


def top_products(x,indices,catalog,names,k):
    binary=x[indices].copy();binary.data[:]=1
    counts=np.asarray(binary.sum(axis=0)).ravel()
    full=x.copy();full.data[:]=1;overall=np.asarray(full.sum(axis=0)).ravel()/x.shape[0]
    order=np.lexsort((np.arange(len(catalog)),-counts))
    return [{'item':catalog[j],'name':names[catalog[j]],'customers':int(counts[j]),'share':float(counts[j]/len(indices)),
             'overall_share':float(overall[j]),'lift':float(counts[j]/len(indices)/overall[j])} for j in order[:k] if counts[j]>0]


def profiles(labels,x,rfm,catalog,names,cfg,rfm_labels):
    result=[]
    for g in sorted(set(labels)):
        idx=np.flatnonzero(labels==g)
        result.append({'id':int(g),'n':len(idx),'share':len(idx)/len(labels),'rfm_median':np.median(rfm[idx],axis=0).tolist(),
            'top':top_products(x,idx,catalog,names,cfg['future_top_k']) if g>=0 else [],
            'rfm_counts':[int(((rfm_labels[idx])==j).sum()) for j in range(4)]})
    return result


def future_stats(frame,origin,ids,labels,profiles_by_method,global_top,days):
    start=pd.Timestamp(origin);future=frame[(frame.date>=start)&(frame.date<start+pd.Timedelta(days=days))&frame.customer.isin(ids)]
    targets=future.groupby('customer').item.agg(lambda s:set(s)).to_dict();out={}
    for method,labs in labels.items():
        top={p['id']:{v['item'] for v in p['top']} for p in profiles_by_method[method]};rows=[]
        for user,g in zip(ids,labs):
            if user not in targets or g<0:continue
            t=targets[user];rows.append({'id':user,'group':int(g),'targets':len(t),'group_hits':len(top[g]&t),'global_hits':len(global_top&t)})
        out[method]={'returning':len(targets),'evaluated':len(rows),'unassigned_returning':sum(user in targets and g<0 for user,g in zip(ids,labs)),
            'group_recall':float(np.mean([r['group_hits']/r['targets'] for r in rows])) if rows else None,
            'global_recall':float(np.mean([r['global_hits']/r['targets'] for r in rows])) if rows else None,'rows':rows}
    return out


def stability(z,labels,cfg):
    output=[];variants=[]
    def add(name,method,alternative):output.append({'variation':name,'method':method,**agreement(labels[method],alternative)})
    for k in cfg['sensitivity']['neighbors']:
        a,_=graph_fit(z,cfg,cfg['seed'],neighbors=k);add(f'neighbors={k}','leiden',a)
    for r in cfg['sensitivity']['resolution']:
        a,_=graph_fit(z,cfg,cfg['seed'],resolution=r);add(f'resolution={r}','leiden',a)
    for seed in cfg['sensitivity']['seeds']:
        a,_=graph_fit(z,cfg,seed);add(f'seed={seed}','leiden',a)
    for size in cfg['sensitivity']['min_cluster_size']:
        a=HDBSCAN(**{**cfg['hdbscan'],'min_cluster_size':size},n_jobs=2).fit_predict(z);add(f'min_cluster_size={size}','hdbscan',a)
    for seed in cfg['subsample_seeds']:
        idx=np.sort(np.random.default_rng(seed).choice(len(z),int(len(z)*cfg['subsample_fraction']),replace=False));sub=z[idx]
        for method in ['kmeans','leiden','hdbscan']:
            if method=='kmeans':a=KMeans(**cfg['kmeans'],random_state=seed).fit_predict(sub)
            elif method=='leiden':a,_=graph_fit(sub,cfg,seed)
            else:a=HDBSCAN(**cfg['hdbscan'],n_jobs=2).fit_predict(sub)
            variants.append({'seed':seed,'method':method,'indices':idx.tolist(),'labels':a.tolist(),**agreement(labels[method][idx],a)})
    return {'sensitivity':output,'subsamples':variants}


def run():
    cfg=load(CONFIG);stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');dest=ROOT/'artifacts/preference-runs'/f'preferences-{stamp}';dest.mkdir(parents=True)
    for name in ['protocol.json','run.py','pyproject.toml','uv.lock']:(dest/name).write_bytes(Path(__file__).with_name(name).read_bytes())
    parent=ROOT/'artifacts/monitoring-runs'/load(ROOT/'artifacts/monitoring-segments.json')['run_id'];old=load(parent/'case.json')
    if sha(parent/'frozen-groups.json')!=old['frozen_sha256']:raise ValueError('Original frozen assignments changed')
    cache=ROOT/'data/processed/transactions.csv.gz';audit=load(ROOT/'data/processed/audit.json')
    if sha(cache)!=audit['processed_sha256'] or old['audit']['processed_sha256']!=audit['processed_sha256']:raise ValueError('Source version changed')
    frame=pd.read_csv(cache,dtype={'customer':'string','invoice':str,'item':str},parse_dates=['date']);windows=[];fitted=None;stored={};started=time.perf_counter()
    for origin in cfg['origins']:
        past=historical(frame,origin,cfg['history_days']);rfm=rfm_at(frame,origin,cfg['history_days']);all_ids=rfm.index.tolist()
        prior=next(s for s in old['snapshots'] if s['origin']==origin);prior_map={r['id']:r for r in prior['rows']}
        if all_ids!=[r['id'] for r in prior['rows']]:raise ValueError('RFM population changed')
        np.testing.assert_allclose(rfm.to_numpy(),[r['rfm'] for r in prior['rows']])
        if fitted is None:fitted,x,z=feature_fit(past,all_ids,cfg)
        else:x,z=feature_transform(past,all_ids,fitted)
        keep=(np.asarray(x.sum(axis=1)).ravel()>0)&(np.linalg.norm(z,axis=1)>1e-12)
        excluded=[u for u,k in zip(all_ids,keep) if not k];ids=[u for u,k in zip(all_ids,keep) if k];x=x[keep];z=z[keep];raw=rfm.to_numpy()[keep]
        names=past.sort_values(['date','invoice'],kind='stable').drop_duplicates('item',keep='last').set_index('item')['name'].to_dict()
        names={item:str(names.get(item,item)) for item in fitted['catalog']}
        rfm_labels_global=np.array([prior_map[u]['cluster'] for u in ids])
        labels,models,graph,times=fit_methods(z,rfm_labels_global,cfg)
        sample=sorted(range(len(ids)),key=lambda i:hashlib.sha256(ids[i].encode()).hexdigest())[:cfg['silhouette_sample']]
        prof={m:profiles(l,x,raw,fitted['catalog'],names,cfg,rfm_labels_global) for m,l in labels.items()}
        neighbor_lists=[[] for _ in ids]
        for (a,b),weight in zip(graph['edges'],graph['weights']):neighbor_lists[a].append((b,weight));neighbor_lists[b].append((a,weight))
        scaled=(np.log1p(raw)-np.asarray(old['model']['scaler_center']))/np.asarray(old['model']['scaler_scale'])
        totals=past.groupby('customer').item.nunique().to_dict()
        rows=[]
        for i,user in enumerate(ids):
            inds=x.getrow(i).indices;counts=x.getrow(i).data;order=np.lexsort((inds,-counts))[:6]
            neighbors=sorted(neighbor_lists[i],key=lambda x:(-x[1],ids[x[0]]));total=sum(w for _,w in neighbors)
            internal=sum(w for j,w in neighbors if labels['leiden'][j]==labels['leiden'][i])
            alternatives=np.flatnonzero((labels['rfm']==labels['rfm'][i])&(labels['leiden']!=labels['leiden'][i]))
            peer=int(alternatives[np.argmin(np.linalg.norm(scaled[alternatives]-scaled[i],axis=1))]) if len(alternatives) else None
            distances=np.sort(models['kmeans'].transform(z[i:i+1])[0])
            rows.append({'id':user,'rfm':raw[i].tolist(),'labels':{m:int(l[i]) for m,l in labels.items()},'catalog_items':len(inds),
                'total_items':int(totals[user]),'purchases':[{'item':fitted['catalog'][inds[k]],'name':names[fitted['catalog'][inds[k]]],'orders':int(counts[k])} for k in order],
                'similar_rfm':ids[peer] if peer is not None else None,'rfm_peer_distance':float(np.linalg.norm(scaled[peer]-scaled[i])) if peer is not None else None,
                'rfm_peer_preference_cosine':float(z[i]@z[peer]) if peer is not None else None,
                'graph_degree':len(neighbors),'graph_internal_share':internal/total if total else None,
                'neighbors':[{'id':ids[j],'similarity':w,'same_group':bool(labels['leiden'][j]==labels['leiden'][i])} for j,w in neighbors[:5]],
                'kmeans_distances':distances[:2].tolist(),'membership_strength':float(models['hdbscan'].probabilities_[i])})
        save(dest/f'assignments-{origin}.json',{'ids':ids,'labels':labels,'profiles':prof,'graph':graph})
        np.savez_compressed(dest/f'features-{origin}.npz',z=z,rfm=raw)
        sparse.save_npz(dest/f'purchases-{origin}.npz',x);stored[origin]=models
        windows.append({'origin':origin,'all_customers':len(all_ids),'excluded_ids':excluded,'rows':rows,'profiles':prof,
            'metrics':{m:summary(l,z,sample) for m,l in labels.items()},'silhouette_ids':[ids[i] for i in sample],
            'global_top':top_products(x,np.arange(len(ids)),fitted['catalog'],names,cfg['future_top_k']),
            'graph':{k:v for k,v in graph.items() if k not in ['edges','weights']}|{'edges':len(graph['edges'])},'training_seconds':times})
        if origin==cfg['origins'][0]:st=stability(z,labels,cfg)
        print(origin,{m:windows[-1]['metrics'][m] for m in METHODS},flush=True)
    joblib.dump({'features':fitted,'models':stored},dest/'models.joblib')
    save(dest/'frozen.json',{'windows':windows,'stability':st})
    for window in windows:
        ids=[r['id'] for r in window['rows']];labs={m:np.array([r['labels'][m] for r in window['rows']]) for m in METHODS}
        window['future']=future_stats(frame,window['origin'],ids,labs,window['profiles'],{r['item'] for r in window['global_top']},cfg['future_days'])
    a,b=windows;ia={r['id']:r for r in a['rows']};ib={r['id']:r for r in b['rows']};common=sorted(ia.keys()&ib.keys())
    temporal={'common':len(common),'entered':len(ib.keys()-ia.keys()),'exited':len(ia.keys()-ib.keys()),'methods':{m:agreement([ia[u]['labels'][m] for u in common],[ib[u]['labels'][m] for u in common]) for m in METHODS}}
    notice=old['notice']+'\nAdditional adaptation: preference TF-IDF/SVD, KMeans, Leiden and HDBSCAN development study. No causal or marketing uplift claim.'
    payload={'schema':1,'run_id':dest.name,'parent_run':old['run_id'],'parent_sha256':sha(parent/'case.json'),'protocol':cfg,'source_sha256':sha(cache),
        'feature_catalog':len(fitted['catalog']),'svd_dimensions':fitted['svd'].n_components,'svd_variance':float(fitted['svd'].explained_variance_ratio_.sum()),
        'windows':windows,'stability':st,'temporal':temporal,'notice':notice,'seconds':time.perf_counter()-started,
        'environment':{'python':platform.python_version(),'sklearn':sklearn.__version__,'igraph':ig.__version__,'leidenalg':la.__version__}}
    save(dest/'case.json',payload);save(dest/'checksums.json',{p.name:sha(p) for p in dest.iterdir() if p.is_file()})
    verify(dest);save(ROOT/'artifacts/preference-latest.json',{'run_id':dest.name,'sha256':sha(dest/'case.json')});export(dest)


def verify(dest):
    for name,digest in load(dest/'checksums.json').items():
        if sha(dest/name)!=digest:raise ValueError(f'Corrupt preference artifact: {name}')
    p=load(dest/'case.json');frozen=load(dest/'frozen.json');models=joblib.load(dest/'models.joblib')
    for w,old in zip(p['windows'],frozen['windows']):
        if {k:v for k,v in w.items() if k!='future'}!=old:raise ValueError('Assignments changed after future scoring')
        ids=[r['id'] for r in w['rows']];z=np.load(dest/f"features-{w['origin']}.npz")['z'];sample=[ids.index(u) for u in w['silhouette_ids']]
        x=sparse.load_npz(dest/f"purchases-{w['origin']}.npz")
        replay=normalize(models['features']['svd'].transform(models['features']['tfidf'].transform(x)))
        np.testing.assert_allclose(replay,z,atol=1e-8)
        for method in ['kmeans','matched']:
            np.testing.assert_array_equal(models['models'][w['origin']][method].predict(z),[r['labels'][method] for r in w['rows']])
        np.testing.assert_array_equal(models['models'][w['origin']]['hdbscan'].labels_,[r['labels']['hdbscan'] for r in w['rows']])
        for m in METHODS:
            labels=np.array([r['labels'][m] for r in w['rows']])
            if summary(labels,z,sample)!=w['metrics'][m]:raise ValueError('Metrics mismatch')
            if sum(v['n'] for v in w['profiles'][m])!=len(ids):raise ValueError('Profile denominator mismatch')
            f=w['future'][m];records=f['rows']
            if f['evaluated']!=len(records) or f['returning']!=len(records)+f['unassigned_returning']:raise ValueError('Future denominator mismatch')
            for key,hits in [('group_recall','group_hits'),('global_recall','global_hits')]:
                actual=float(np.mean([r[hits]/r['targets'] for r in records])) if records else None
                if actual!=f[key]:raise ValueError('Future metric mismatch')
    print('Verified',dest.name,flush=True)
    return p


def export(dest):
    p=verify(dest);digest=sha(dest/'case.json');directory=ROOT/'apps/web/preference-results'/digest[:16];directory.mkdir(parents=True,exist_ok=True)
    (directory/'case.json').write_bytes((dest/'case.json').read_bytes())
    save(directory.parent/'manifest.json',{'run_id':p['run_id'],'path':digest[:16]+'/case.json','sha256':digest})
    print('Exported',p['run_id'],flush=True)

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='verify':
        pointer=load(ROOT/'artifacts/preference-latest.json');dest=ROOT/'artifacts/preference-runs'/pointer['run_id']
        if sha(dest/'case.json')!=pointer['sha256']:raise ValueError('Pointer mismatch')
        export(dest)
    else:run()

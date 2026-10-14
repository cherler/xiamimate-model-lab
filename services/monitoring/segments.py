"""Historical retail segmentation: frozen RFM rules, KMeans and stability audit."""
import hashlib
import platform
import time
import joblib
import numpy as np
import pandas as pd
import sklearn
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import RobustScaler
from .common import ROOT, CONFIG, load, save, sha, create_run, export

RULE_NAMES=['90 天未购买','仅一次购买','活跃复购','其他在购']


def rfm_at(frame, origin, days=180):
    origin=pd.Timestamp(origin)
    past=frame[(frame.date>=origin-pd.Timedelta(days=days))&(frame.date<origin)&frame.customer.notna()].copy()
    past['gross']=past.quantity*past.price
    group=past.groupby('customer',sort=True)
    result=group.agg(last=('date','max'),orders=('invoice','nunique'),gross=('gross','sum'))
    result['recency']=(origin-result['last']).dt.days
    return result[['recency','orders','gross']]


def rule_labels(rfm):
    r,f,m=rfm.T
    return np.where(r>90,0,np.where(f==1,1,np.where((r<=30)&(f>=3),2,3))).astype(int)


def future_at(frame, ids, origin, days=30):
    origin=pd.Timestamp(origin)
    f=frame[(frame.date>=origin)&(frame.date<origin+pd.Timedelta(days=days))&frame.customer.isin(ids)].copy()
    f['gross']=f.quantity*f.price
    return f.groupby('customer').agg(orders=('invoice','nunique'),gross=('gross','sum')).reindex(ids,fill_value=0)


def profiles(rows, method):
    result=[];total=sum(r['rfm'][2] for r in rows)
    for label in range(4):
        subset=[r for r in rows if r[method]==label];X=np.array([r['rfm'] for r in subset])
        result.append({'group':label,'n':len(subset),'share':len(subset)/len(rows),'median_rfm':np.median(X,axis=0).tolist() if subset else None,
                       'gross':sum(r['rfm'][2] for r in subset),'sales_share':sum(r['rfm'][2] for r in subset)/total if total else None,
                       'future_return_rate':sum(r['future_orders']>0 for r in subset)/len(subset) if subset else None,'future_gross':sum(r['future_gross'] for r in subset)})
    return result


def transitions(first, second, method):
    a={r['id']:r[method] for r in first};b={r['id']:r[method] for r in second};common=sorted(a.keys()&b.keys())
    matrix=np.zeros((4,4),int)
    for key in common:matrix[a[key],b[key]]+=1
    return {'common':len(common),'entered':len(b.keys()-a.keys()),'exited':len(a.keys()-b.keys()),'matrix':matrix.tolist(),
            'same_share':sum(a[k]==b[k] for k in common)/len(common),'ari':float(adjusted_rand_score([a[k] for k in common],[b[k] for k in common]))}


def run():
    cfg=load(CONFIG);c=cfg['segmentation'];started=time.perf_counter()
    source=ROOT/'data/raw/verified-mirror.xlsx'
    if sha(source)!=c['xlsx_sha256']:raise ValueError('Retail source hash mismatch')
    cache=ROOT/'data/processed/transactions.csv.gz';audit=load(ROOT/'data/processed/audit.json')
    fingerprint=hashlib.sha256((ROOT/'services/prepare_data.py').read_bytes()+(ROOT/'services/ml/core.py').read_bytes()).hexdigest()
    if audit['processed_sha256']!=sha(cache) or audit['cleaning_code_sha256']!=fingerprint or audit['xlsx_sha256']!=c['xlsx_sha256']:raise ValueError('Retail cleaned cache mismatch')
    frame=pd.read_csv(cache,dtype={'customer':'string','invoice':str,'item':str},parse_dates=['date'])
    run_id,dest=create_run('segments');snapshots=[];initial=rfm_at(frame,c['origins'][0]);ids=initial.index.tolist();X=initial.to_numpy(float)
    scaler=RobustScaler().fit(np.log1p(X));Z=scaler.transform(np.log1p(X))
    km=KMeans(n_clusters=4,n_init=10,random_state=cfg['seed']).fit(Z)
    order=np.argsort(km.cluster_centers_[:,2],kind='stable');mapping={int(old):i for i,old in enumerate(order)}
    pca=PCA(n_components=2,svd_solver='full').fit(Z)
    for origin in c['origins']:
        features=rfm_at(frame,origin);raw=features.to_numpy(float);z=scaler.transform(np.log1p(raw));labels=np.array([mapping[int(v)] for v in km.predict(z)]);rules=rule_labels(raw);xy=pca.transform(z)
        rows=[{'id':str(key),'rfm':raw[i].tolist(),'cluster':int(labels[i]),'rule':int(rules[i]),'xy':xy[i].tolist()} for i,key in enumerate(features.index)]
        samples=sorted(range(len(rows)),key=lambda i:hashlib.sha256(f"{cfg['seed']}:{rows[i]['id']}".encode()).hexdigest())[:2000]
        silhouette={m:float(silhouette_score(z[samples],values[samples])) for m,values in [('cluster',labels),('rule',rules)]}
        snapshots.append({'origin':origin,'rows':rows,'silhouette':silhouette,'silhouette_n':len(samples),'silhouette_ids':[rows[i]['id'] for i in samples]})
    baseline=np.array([r['cluster'] for r in snapshots[0]['rows']]);stability=[]
    for i in range(c['stability_runs']):
        rng=np.random.default_rng(cfg['seed']+i);idx=rng.choice(len(X),int(len(X)*.8),replace=False)
        fitted=RobustScaler().fit(np.log1p(X[idx]));model=KMeans(n_clusters=4,n_init=10,random_state=cfg['seed']+i).fit(fitted.transform(np.log1p(X[idx])))
        alternative=model.predict(fitted.transform(np.log1p(X)));confusion=np.zeros((4,4),int)
        for a,b in zip(baseline,alternative):confusion[a,b]+=1
        rr,cc=linear_sum_assignment(-confusion);matched=dict(zip(rr,cc))
        stability.append({'seed':cfg['seed']+i,'sample_n':len(idx),'ari':float(adjusted_rand_score(baseline,alternative)),
                          'retention':[float(confusion[g,matched[g]]/sum(baseline==g)) for g in range(4)],'assignments':alternative.tolist()})
    save(dest/'frozen-groups.json',snapshots)
    frozen_sha=sha(dest/'frozen-groups.json')
    joblib.dump({'scaler':scaler,'kmeans':km,'mapping':mapping,'pca':pca},dest/'models.joblib')
    for snapshot in snapshots:
        rows=snapshot['rows'];future=future_at(frame,[r['id'] for r in rows],snapshot['origin'])
        for row in rows:
            value=future.loc[row['id']];row['future_orders']=int(value.orders);row['future_gross']=float(value.gross)
        snapshot['profiles']={m:profiles(rows,m) for m in ['cluster','rule']}
    payload={'kind':'segments','run_id':run_id,'protocol':cfg,'protocol_sha256':sha(dest/'protocol.json'),'frozen_sha256':frozen_sha,'snapshots':snapshots,'rule_names':RULE_NAMES,'stability':stability,
             'transitions':{m:transitions(snapshots[0]['rows'],snapshots[1]['rows'],m) for m in ['cluster','rule']},
             'model':{'scaler_center':scaler.center_.tolist(),'scaler_scale':scaler.scale_.tolist(),'centers':km.cluster_centers_[order].tolist(),'pca_mean':pca.mean_.tolist(),'pca_components':pca.components_.tolist(),'pca_variance_ratio':pca.explained_variance_ratio_.tolist()},
             'audit':audit,'source_sha256':c['xlsx_sha256'],'model_sha256':sha(dest/'models.joblib'),'seconds':time.perf_counter()-started,'environment':{'python':platform.python_version(),'sklearn':sklearn.__version__},
             'notice':'Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D\nhttps://archive.ics.uci.edu/dataset/502/online+retail+ii\nCC BY 4.0 https://creativecommons.org/licenses/by/4.0/\nAdaptation: valid positive merchandise transactions with customer IDs; 180-day RFM, fixed rules, KMeans, temporal and resampling audits. Excludes returns; gross sales are not profit or net revenue. Anonymous IDs only. Future behavior is descriptive, not causal marketing uplift.'}
    save(dest/'case.json',payload);export('segments',dest)
    print('customers:',[len(s['rows']) for s in snapshots], 'silhouette:',[s['silhouette'] for s in snapshots],flush=True)
    print('stability ARI:',[s['ari'] for s in stability], 'transitions:',payload['transitions'],flush=True)


if __name__=='__main__':run()

"""Local Dressipi CPU pilot. No network, web uploads, or official test-file reads."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import numpy as np
import pandas as pd
from lightgbm import LGBMRanker
from .dressipi import SessionBaselines, ranking_metrics, temporal_split, validate_tables
from .m5_data import ROOT, digest, write

CONFIG = Path(__file__).with_name('dressipi-local.json')
FEATURES = ['log_purchase_count','cooccurrence_score','attribute_score','popularity_rank',
            'cooccurrence_rank','attribute_rank','shared_last_attributes','last_attribute_jaccard',
            'candidate_attribute_count','session_length','session_unique_items','matched_view_items']


def stable_sample(ids, limit):
    return sorted(set(map(str, ids)), key=lambda s: hashlib.sha256(s.encode()).hexdigest())[:limit]


def queries(views, purchases, limit):
    ids = stable_sample(views.session_id, limit)
    groups = views[views.session_id.isin(ids)].sort_values(['session_id','date','item_id'], kind='stable').groupby('session_id', sort=False)
    targets = purchases.set_index('session_id').item_id.to_dict()
    return [(sid, rows.item_id.tolist(), str(targets[sid])) for sid, rows in groups]


def candidate_features(model, sequence, catalogue):
    # Retrieval has no target argument. A missing label must never be added to the pool.
    ranked = {method:model.predict(sequence,catalogue,method,100) for method in ['popularity','cooccurrence','attributes']}
    pool = sorted(set().union(*map(set,ranked.values())))
    ranks = {k:{item:i+1 for i,item in enumerate(v)} for k,v in ranked.items()}
    co = Counter(); attr = Counter()
    for age,item in enumerate(reversed(sequence)):
        weight = .8 ** age; links=model.links.get(item,{}); denominator=sum(links.values()) or 1
        for candidate,count in links.items():co[candidate]+=weight*count/denominator
        a=model.attributes.get(item,set())
        for candidate in pool:
            other=model.attributes.get(candidate,set())
            attr[candidate]+=weight*len(a&other)/(len(a|other) or 1)
    last = model.attributes.get(sequence[-1],set())
    rows=[]
    for item in pool:
        a=model.attributes.get(item,set()); shared=len(last&a)
        rows.append([np.log1p(model.popularity[item]),co[item],attr[item],
                     *[ranks[k].get(item,101) for k in ['popularity','cooccurrence','attributes']],
                     shared,shared/(len(last|a) or 1),len(a),len(sequence),len(set(sequence)),
                     sum(bool(a&model.attributes.get(v,set())) for v in set(sequence))])
    return pool,np.asarray(rows,dtype='float32'),ranked


def evaluate(model, ranker, query_rows, catalogue, keep_samples=12):
    targets={}; predictions={m:{} for m in ['popularity','cooccurrence','attributes','lightgbm']}
    samples=[];retrieved=0; rows=[]
    for index,(sid,seq,target) in enumerate(query_rows):
        pool,x,ranked=candidate_features(model,seq,catalogue)
        scores=ranker.predict(pd.DataFrame(x,columns=FEATURES)) if len(pool) else []
        ranked['lightgbm']=[pool[i] for i in sorted(range(len(pool)),key=lambda i:(-scores[i],pool[i]))[:100]]
        targets[sid]=target;retrieved+=target in pool
        for name in predictions:predictions[name][sid]=ranked[name]
        rows.append({'session':sid,'target':target,'pool':pool,'rankings':ranked})
        if index<keep_samples:
            shown=set(seq)|{target}|set().union(*(set(v[:10]) for v in ranked.values()))
            samples.append({'session':sid,'sequence':seq,'target':target,'pool_size':len(pool),'target_retrieved':target in pool,
                            'rankings':ranked,'attributes':{i:[list(a) for a in sorted(model.attributes.get(i,set()))] for i in sorted(shown)}})
        if (index+1)%100==0:print(f'Evaluated {index+1}/{len(query_rows)} sessions',flush=True)
    metrics={m:ranking_metrics(targets,p,catalogue) for m,p in predictions.items()}
    return metrics, {'retrieval_recall':retrieved/len(targets),'sessions':len(targets)}, samples,rows


def run(data_dir):
    cfg=json.loads(CONFIG.read_text()); names=['train_sessions.csv','train_purchases.csv','item_features.csv']
    paths=[data_dir/n for n in names]
    if any(not p.is_file() for p in paths):raise ValueError('需要 train_sessions.csv、train_purchases.csv 和 item_features.csv，未读取任何测试文件')
    source_path=data_dir/'source.json'
    if not source_path.exists():raise ValueError('缺少 source.json 数据来源和用途记录')
    source=json.loads(source_path.read_text())
    if source.get('mode')!='local_research_only' or source.get('public_export_allowed') is not False:raise ValueError('仅支持记录为 local_research_only 的研究数据')
    for p in paths:
        if source.get('files',{}).get(p.name,{}).get('sha256')!=digest(p):raise ValueError(f'data hash mismatch: {p.name}')
    views,targets,attrs=[pd.read_csv(p,dtype=str) for p in paths]
    validate_tables(views,targets,attrs)
    # Both views and purchase must fit entirely inside their partition.
    base,buy,rankv,rankp=temporal_split(views,targets,cfg['base_before'],cfg['ranking_before'])
    _,_,validv,validp=temporal_split(views,targets,cfg['ranking_before'],cfg['validation_end_exclusive'])
    ids=stable_sample(base.session_id,cfg['max_base_sessions']);base=base[base.session_id.isin(ids)];buy=buy[buy.session_id.isin(ids)]
    train_queries=queries(rankv,rankp,cfg['max_ranking_sessions']);valid_queries=queries(validv,validp,cfg['max_validation_sessions'])
    if not len(ids) or not train_queries or not valid_queries:raise ValueError('日期分区没有足够会话，不能伪造结果')
    run_id='dressipi-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');folder=ROOT/'artifacts/competition-runs'/run_id;folder.mkdir(parents=True)
    write(folder/'protocol.json',cfg);write(folder/'source.json',source)
    started=time.perf_counter();model=SessionBaselines().fit(base,buy,attrs);catalogue=sorted(set(attrs.item_id));write(folder/'catalogue.json',catalogue)
    xs=[];ys=[];groups=[];missed=0
    for i,(_,seq,target) in enumerate(train_queries):
        pool,x,_=candidate_features(model,seq,catalogue)
        if target not in pool:missed+=1;continue
        xs.append(x);ys.extend(int(v==target) for v in pool);groups.append(len(pool))
        if (i+1)%250==0:print(f'Prepared ranking query {i+1}/{len(train_queries)}',flush=True)
    if len(groups)<2:raise ValueError('不足两个含正样本的训练查询')
    ranker=LGBMRanker(**cfg['params']);ranker.fit(np.concatenate(xs),np.asarray(ys),group=groups,feature_name=FEATURES)
    ranker.booster_.save_model(str(folder/'ranker.txt'))
    fit_seconds=time.perf_counter()-started
    # Model/parameters fixed before April labels are evaluated. This remains development evidence.
    write(folder/'frozen.json',{'model_sha256':digest(folder/'ranker.txt'),'protocol_sha256':digest(folder/'protocol.json')})
    metrics,retrieval,samples,rows=evaluate(model,ranker,valid_queries,catalogue)
    write(folder/'predictions.json',rows);write(folder/'samples.json',samples)
    report={'run_id':run_id,'status':'complete_development','mode':'local_research_only','public_export_allowed':False,
            'protocol':cfg,'models':metrics,'retrieval':retrieval,'features':FEATURES,
            'cohort':{'catalogue_items':len(catalogue),'base_sessions':len(ids),'ranking_sessions':len(train_queries),
                      'ranking_retrieval_misses':missed,'ranking_fitted_queries':len(groups),'validation_sessions':len(valid_queries)},
            'cost':{'fit_seconds':fit_seconds,'total_seconds':time.perf_counter()-started},
            'inputs':{p.name:digest(p) for p in paths},'code':{p.name:digest(p) for p in [Path(__file__),Path(__file__).with_name('dressipi.py')]}}
    write(folder/'report.json',report)
    write(folder/'checksums.json',{p.name:digest(p) for p in folder.iterdir() if p.is_file()})
    write(ROOT/'artifacts/competition-dressipi.json',{'run_id':run_id,'report_sha256':digest(folder/'report.json')})
    print(json.dumps({'run_id':run_id,'models':metrics},ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',type=Path,default=ROOT/'data/raw/dressipi');args=parser.parse_args();run(args.data_dir)

"""Inventory before scoring: all real NAB paths, no outcome/label-based inclusion."""
import hashlib,json,urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import pandas as pd
from services.monitoring.common import ROOT,save,load,sha
REV='ea702d75cc2258d9d7dd35ca8e5e2539d71f3140'
RAW=ROOT/'data/raw/e7-nab'
LEGACY=['data/realKnownCause/'+s+'.csv' for s in ['ambient_temperature_system_failure','machine_temperature_system_failure','cpu_utilization_asg_misconfiguration']]
RULES={'minimum_rows':200,'minimum_cadence_seconds':60,'minimum_train_hours':24,'minimum_calibration_hours':12,'minimum_evaluation_hours':48,'minimum_valid_train':24,'minimum_valid_calibration':24,'minimum_valid_evaluation':100}

def clean(path):
    f=pd.read_csv(path);raw=len(f);f['timestamp']=pd.to_datetime(f.timestamp,errors='raise');ordered=bool(f.timestamp.is_monotonic_increasing)
    f=f.drop_duplicates('timestamp',keep='first').sort_values('timestamp',kind='stable').reset_index(drop=True)
    if f.timestamp.isna().any() or not np.isfinite(f.value.to_numpy(float)).all():raise ValueError('Invalid timestamp/value')
    return f,{'raw_rows':raw,'duplicates_removed':raw-len(f),'source_chronological':ordered}

def inspect(path,filename):
    f,info=clean(filename);n=len(f);a,b=int(n*.2),int(n*.3);times=f.timestamp.astype('int64').to_numpy()//10**6
    cadence=float(np.median(np.diff(times)));valid=pd.Series(1.,index=pd.DatetimeIndex(f.timestamp)).rolling('24h',closed='left').count().to_numpy()>=12
    def hours(lo,hi):return float((times[hi-1]-times[lo]+cadence)/3600000) if hi>lo else 0
    spans=[hours(0,a),hours(a,b),hours(b,n)];counts=[int(valid[:a].sum()),int(valid[a:b].sum()),int(valid[b:].sum())]
    reasons=[]
    if path in LEGACY:reasons.append('legacy_case_not_new_evidence')
    if n<RULES['minimum_rows']:reasons.append('too_few_rows')
    if cadence/1000<RULES['minimum_cadence_seconds']:reasons.append('subminute_not_this_monitoring_scope')
    for label,span,minimum in zip(['train','calibration','evaluation'],spans,[24,12,48]):
        if span<minimum:reasons.append(label+'_span_too_short')
    for label,count,minimum in zip(['train','calibration','evaluation'],counts,[24,24,100]):
        if count<minimum:reasons.append(label+'_history_too_short')
    return {'path':path,'id':path[5:-4],'family':path.split('/')[1],'sha256':sha(filename),'rows':n,**info,'cadence_seconds':cadence/1000,'max_gap_seconds':float(np.diff(times).max()/1000),'gap_count_over_3_cadences':int((np.diff(times)>cadence*3).sum()),'train_end':a,'cal_end':b,'split_hours':spans,'valid_counts':counts,'start':str(f.timestamp.iloc[0]),'evaluation_start':str(f.timestamp.iloc[b]),'end':str(f.timestamp.iloc[-1]),'included':not reasons,'exclusion_reasons':reasons}

def main():
    tree=load(RAW/'tree.json');paths=sorted(x['path'] for x in tree['tree'] if x['path'].startswith('data/real') and x['path'].endswith('.csv'))
    if tree.get('truncated') or tree['sha']!=REV or len(paths)!=47:raise ValueError('Unexpected inventory')
    blobs={x['path']:x['sha'] for x in tree['tree'] if x['type']=='blob'}
    def fetch(name):
        path=RAW/name;path.parent.mkdir(parents=True,exist_ok=True)
        if not path.exists():urllib.request.urlretrieve(f'https://raw.githubusercontent.com/numenta/NAB/{REV}/{name}',path)
        raw=path.read_bytes();gitsha=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        if gitsha!=blobs[name]:raise ValueError('Pinned Git blob mismatch '+name)
        return name,sha(path)
    with ThreadPoolExecutor(max_workers=6) as pool:hashes=dict(pool.map(fetch,[*paths,'LICENSE.txt','data/README.md','labels/combined_windows.json']))
    # Labels downloaded/hash-bound, deliberately not parsed in inventory stage.
    rows=[inspect(path,RAW/path) for path in paths]
    result={'schema':'anomaly-cross-audit-v1','revision':REV,'tree_sha256':sha(RAW/'tree.json'),'rules':RULES,'files':hashes,'series':rows,'included':sum(r['included'] for r in rows),'legacy_paths':LEGACY,'label_policy':'Label bytes pinned but not parsed in this audit. Existing R5 previously accessed the full public label file; no independent or previously unseen benchmark claim.','license':'Pinned NAB repository LICENSE.txt MIT; retain copyright/full notice and corpus README/source attribution. Single-valued public benchmark, no real incident resolution labels.'}
    save(ROOT/'docs/evaluation/anomaly-cross-audit-v1.json',result)
    print(json.dumps({'included':result['included'],'excluded':[(r['id'],r['exclusion_reasons']) for r in rows if not r['included']],'families':{f:sum(r['included'] and r['family']==f for r in rows) for f in sorted({r['family'] for r in rows})}},ensure_ascii=False))
if __name__=='__main__':main()

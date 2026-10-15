"""Audit/derive only published UCI recommendation results. Never fit or read raw labels."""
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PROTOCOL=Path(__file__).with_name('uci-protocol.json')
def digest(raw):return hashlib.sha256(raw).hexdigest()
def read(p):return json.loads(p.read_text())
def near(a,b):
    if not math.isfinite(a) or abs(a-b)>1e-8:raise ValueError('Metric mismatch')
def integer(v):
    near(v,round(v))
    if v<0:raise ValueError('Negative count')
    return round(v)
def activity(n):return 'cold' if n==0 else '1–5' if n<=5 else '6–20' if n<=20 else '21+'
def load_sources():
    p=read(PROTOCOL);root=ROOT/'apps/web/uci-results';m=read(root/'manifest.json')
    if m['version']!=p['parent_version'] or m['run_id']!=p['parent_run']:raise ValueError('Parent changed')
    data={}
    for name,sha in p['sources'].items():
        raw=(root/m['version']/name).read_bytes()
        if digest(raw)!=sha or m['files'][name]['sha256']!=sha:raise ValueError('Source hash mismatch: '+name)
        data[name]=list(csv.DictReader(io.StringIO(gzip.decompress(raw).decode()))) if name.endswith('.gz') else json.loads(raw)
    run=ROOT/'artifacts/runs'/m['run_id']
    for name,sha in p['source_code'].items():
        if digest((run/'source'/name).read_bytes())!=sha or data['report.json']['code_sha256'][name]!=sha:raise ValueError('History provenance changed')
    raw=(run/'model.json').read_bytes()
    if digest(raw)!=p['november_model_sha256']:raise ValueError('November history changed')
    model=json.loads(raw)
    if model['as_of']!='2011-11-01':raise ValueError('History origin changed')
    return p,m,data,model

def normalize(p,data,model):
    diagnostics={}
    for r in data['recommendation-diagnostics.csv.gz']:
        key=(r['model'],r['origin'],r['customer'])
        if key in diagnostics:raise ValueError('Duplicate diagnostics')
        diagnostics[key]=r
    records={};seen={};cold_equal=0;november_checked=0
    for method in p['models']:
        found=set()
        for r in data[f'validation-predictions-{method}.csv.gz']:
            key=(r['origin'],r['customer'])
            if key in found or r['origin'] not in p['origins']:raise ValueError('Duplicate or invalid window')
            found.add(key);d=diagnostics.get((method,*key))
            if not d:raise ValueError('Missing historical group')
            target=json.loads(r['target']);ranked=json.loads(r['ranked']);n=len(target);target_set=set(target)
            if not n or n!=len(target_set) or len(ranked)!=10 or len(set(ranked))!=10:raise ValueError('Invalid target/rank scope')
            hits=len(set(ranked)&target_set);oov=int(r['oov_targets']);a=d['activity']
            if not 0<=oov<=n or a not in p['groups'] or (r['cohort']=='cold')!=(a=='cold'):raise ValueError('History group or OOV mismatch')
            ndcg=sum(1/math.log2(i+2) for i,x in enumerate(ranked) if x in target_set)/sum(1/math.log2(i+2) for i in range(min(10,n)))
            for k,v in [('recall',hits/n),('ndcg',ndcg),('hit_rate',int(hits>0))]:near(float(r[k]),v);near(float(d[k]),v)
            near(float(d['precision']),hits/10);near(float(d['basket_size']),n);near(float(d['ideal_recall']),min(10,n-oov)/n)
            repeat=integer(float(d['repeat_share'])*n);novel=n-repeat
            if repeat>n:raise ValueError('Repeat targets exceed basket')
            repeat_hits=integer(float(d['repeat_recall'])*repeat) if repeat else 0
            novel_hits=integer(float(d['novel_recall'])*novel) if novel else 0
            if (not repeat and d['repeat_recall']) or (not novel and d['novel_recall']) or repeat_hits+novel_hits!=hits or repeat_hits>repeat or novel_hits>novel:raise ValueError('Repeat/novel counts mismatch')
            common={'origin':r['origin'],'customer':r['customer'],'activity':a,'targets':n,'oov':oov,'repeat':repeat,'novel':novel}
            if key not in records:records[key]={**common,'methods':{}}
            if any(records[key][k]!=v for k,v in common.items()):raise ValueError('Methods not paired to identical targets/groups')
            if r['fallback'] not in ['True','False']:raise ValueError('Invalid fallback')
            records[key]['methods'][method]={'hits':hits,'ndcg':ndcg,'fallback':r['fallback']=='True','repeat_hits':repeat_hits,'novel_hits':novel_hits}
            if method==p['models'][0]:seen[key]=target,ranked
            elif target!=seen[key][0]:raise ValueError('Target identities differ')
            if a=='cold':
                if ranked!=seen[key][1] or (method!='popular' and r['fallback']!='True'):raise ValueError('Cold output not popularity fallback')
                cold_equal+=1
            if r['origin']=='2011-11-01':
                if activity(len(model['histories'].get(r['customer'],[])))!=a:raise ValueError('November history group mismatch')
                november_checked+=1
        if len(found)!=4280 or (records.keys()!=found):raise ValueError('Incomplete paired population')
    if len(diagnostics)!=len(records)*len(p['models']):raise ValueError('Unmatched diagnostic rows')
    result=sorted(records.values(),key=lambda r:(r['origin'],r['customer']))
    report=data['report.json']['recommendation']['models']
    for method in p['models']:
        if len(set(r['customer'] for r in result))!=report[method]['unique_customers']:raise ValueError('Unique customers mismatch')
        for w in report[method]['windows']:
            part=[r for r in result if r['origin']==w['origin']]
            if len(part)!=w['users']:raise ValueError('Window population mismatch')
            for k,fn in [('ndcg',lambda r:r['methods'][method]['ndcg']),('recall',lambda r:r['methods'][method]['hits']/r['targets']),('hit_rate',lambda r:int(r['methods'][method]['hits']>0))]:near(sum(fn(r) for r in part)/len(part),w[k])
    return result,{'november_history_checks':november_checked,'cold_method_checks':cold_equal}

def audit(p,m,data,model):
    rows,checks=normalize(p,data,model)
    return {'schema':'uci-adoption-audit-v1','parent_run':m['run_id'],'parent_version':m['version'],'protocol_sha256':digest(PROTOCOL.read_bytes()),'sources':p['sources'],'rows_per_method':len(rows),'unique_customers':len(set(r['customer'] for r in rows)), 'model_count':len(p['models']),'origins':{o:sum(r['origin']==o for r in rows) for o in p['origins']},'groups':{g:sum(r['activity']==g for r in rows) for g in p['groups']},**checks,'history_evidence':'Sep/Oct: frozen activity categories and hash-verified generating code (training date < origin, catalog intersected history). Nov: additionally checked every evaluated customer against saved as_of model histories. No reconstruction of earlier exact histories.', 'restrictions':p['restrictions']}

def main():
    p,m,data,model=load_sources();a=audit(p,m,data,model)
    (ROOT/'docs/evaluation/uci-adoption-audit-v1.json').write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:a[k] for k in ['rows_per_method','unique_customers','origins','groups','november_history_checks','cold_method_checks']},ensure_ascii=False))
if __name__=='__main__':main()

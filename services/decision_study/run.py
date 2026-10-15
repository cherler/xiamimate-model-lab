"""Freeze new service orders before attaching known parent outcomes; immutable runs."""
import argparse
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
from services.monitoring.common import load,save,sha
from services.decision.core import inputs,metrics
from .audit import ROOT,source,audit,PARENT_SHA
from .solver import solve
PROTOCOL=Path(__file__).with_name('protocol.json')
CODE=['services/decision_study/audit.py','services/decision_study/solver.py','services/decision_study/run.py','services/decision/core.py']

def check_metrics(got,saved):
    if set(got)!=set(saved):raise ValueError('Metric keys changed')
    for k,v in got.items():
        if v is None or isinstance(v,bool):
            if v!=saved[k]:raise ValueError('Metric changed')
        else:np.testing.assert_allclose(v,saved[k],rtol=1e-8,atol=1e-4)

def verify(p,parent):
    cfg=p['protocol']
    if cfg!=load(PROTOCOL) or p['protocol_sha256']!=sha(PROTOCOL) or p['parent_sha256']!=PARENT_SHA:raise ValueError('Protocol changed')
    expected={(o,m,b,c) for o in cfg['origins'] for m in cfg['models'] for b in cfg['budget_ratios'] for c in cfg['capacity_ratios']}
    if len(p['records'])!=len(expected):raise ValueError('Scope changed')
    seen=set()
    for r in p['records']:
        key=(r['origin'],r['model'],r['budget'],r['capacity'])
        if key not in expected or key in seen:raise ValueError('Duplicate/missing config')
        seen.add(key);w=next(w for w in parent['windows'] if w['origin']==r['origin'])
        x=inputs(w['items'],r['model'],r['budget'],r['capacity'],cfg['shortage_ratio'],parent['protocol'])
        original=next(q for q in w['plans'] if (q['model'],q['budget_ratio'],q['capacity_ratio'],q['shortage_ratio'])==(r['model'],r['budget'],r['capacity'],cfg['shortage_ratio']))
        if [q['target'] for q in r['services']]!=cfg['targets']:raise ValueError('Service scope changed')
        for result in [r['ceiling'],*r['services']]:
            if result['status'] not in [0,1,2,3,4]:raise ValueError('Solver status invalid')
            if result['status']!=0:
                if result['packs'] is not None or result.get('observed') is not None:raise ValueError('Unsolved order presented')
                continue
            m=metrics(x,result['packs']);check_metrics(m,result['expected'])
            if not m['feasible']:raise ValueError('Infeasible order')
            objective=m['shortage_units'] if result is r['ceiling'] else m['total_cost']
            np.testing.assert_allclose(objective,result['objective'],rtol=1e-7,atol=1e-3)
            if not 0<=result['gap']<=cfg['solver']['mip_rel_gap']+1e-8 or result['dual_bound']>objective+.01 or objective-result['dual_bound']>max(.01,abs(objective)*(cfg['solver']['mip_rel_gap']+1e-8)):raise ValueError('Invalid optimality bound')
            if result is r['ceiling']:continue
            if m['fill_rate'] is not None and m['fill_rate']<result['target']-1e-8:raise ValueError('Service violation')
            check_metrics(metrics(x,result['packs'],[i['actual'] for i in w['items']]),result['observed'])
            tol=max(.1,abs(m['total_cost'])*2e-6)
            if m['total_cost']<original['policies']['milp']['expected']['total_cost']-tol:raise ValueError('Constraint reduces optimum unexpectedly')
            for base in original['policies'].values():
                if base['expected']['fill_rate'] is not None and base['expected']['fill_rate']>=result['target']-1e-8 and m['total_cost']>base['expected']['total_cost']+tol:raise ValueError('Worse than eligible rule')
        if r['ceiling']['status']==0:
            ceil=r['ceiling'];d=ceil['expected']['demand_units']
            upper=1-max(0,ceil['dual_bound'])/d if d else None
            for result in r['services']:
                if result['status']==0 and d and result['expected']['fill_rate']>upper+1e-8:raise ValueError('Service exceeds bound')
                if result['status']==2 and d and ceil['expected']['fill_rate']>=result['target']+1e-8:raise ValueError('Infeasibility contradicts witness')
    return p

def publish(dest):
    parent,_=source();p=verify(load(dest/'case.json'),parent)
    for filename,key in [('protocol.json','protocol_sha256'),('inputs.json','inputs_sha256'),('orders.json','orders_sha256')]:
        if sha(dest/filename)!=p[key]:raise ValueError('Frozen file changed')
    frozen=load(dest/'orders.json')
    for r,saved in zip(p['records'],frozen,strict=True):
        clean={**r,'services':[{k:v for k,v in s.items() if k!='observed'} for s in r['services']]}
        if clean!=saved:raise ValueError('Orders changed after freeze')
    for name,digest in p['code_sha256'].items():
        if sha(dest/'source'/name)!=digest or sha(ROOT/name)!=digest:raise ValueError('Source changed')
    raw=(dest/'case.json').read_bytes();digest=sha(dest/'case.json');path=f'{digest[:16]}/case.json';folder=ROOT/'apps/web/decision-service-results';(folder/path).parent.mkdir(parents=True,exist_ok=True);(folder/path).write_bytes(raw)
    manifest={'schema':p['schema'],'path':path,'sha256':digest,'run_id':p['run_id'],'parent_sha256':PARENT_SHA,'protocol_sha256':p['protocol_sha256']}
    save(folder/'manifest.json',manifest)
    counts={str(t):{str(status):sum(s['status']==status for r in p['records'] for s in r['services'] if s['target']==t) for status in range(5)} for t in p['protocol']['targets']}
    save(ROOT/'docs/evaluation/decision-service-export-v1.json',{**manifest,'bytes':len(raw),'counts':counts,'orders_sha256':p['orders_sha256'],'inputs_sha256':p['inputs_sha256'],'code_sha256':p['code_sha256']})
    print('Verified and exported',p['run_id'],counts,flush=True)

def run():
    parent,before=source();cfg=load(PROTOCOL)
    if sha(ROOT/'docs/evaluation/decision-service-audit-v1.json')!=cfg['audit_sha256'] or audit(parent)!=load(ROOT/'docs/evaluation/decision-service-audit-v1.json'):raise ValueError('Audit changed')
    rid='decision-service-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');dest=ROOT/'artifacts/decision-service-runs'/rid;dest.mkdir(parents=True,exist_ok=False)
    (dest/'protocol.json').write_bytes(PROTOCOL.read_bytes());save(dest/'inputs.json',before)
    for name in CODE:
        path=dest/'source'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes((ROOT/name).read_bytes())
    records=[]
    for w in before:
        for model in cfg['models']:
            for budget in cfg['budget_ratios']:
                for capacity in cfg['capacity_ratios']:
                    x=inputs(w['items'],model,budget,capacity,cfg['shortage_ratio'],parent['protocol'])
                    ceiling=solve(x,cfg['solver'],max_service=True)
                    services=[{'target':t,**solve(x,cfg['solver'],target=t)} for t in cfg['targets']]
                    records.append({'origin':w['origin'],'model':model,'budget':budget,'capacity':capacity,'ceiling':ceiling,'services':services})
        print('Solved',w['origin'],len(records),'configurations',flush=True)
    save(dest/'orders.json',records)
    (dest/'outcome-access.txt').write_text('All orders/statuses saved before attaching already-known parent development sales; no independent test claim.\n')
    for r in records:
        w=next(w for w in parent['windows'] if w['origin']==r['origin']);x=inputs(w['items'],r['model'],r['budget'],r['capacity'],cfg['shortage_ratio'],parent['protocol'])
        for s in r['services']:s['observed']=metrics(x,s['packs'],[i['actual'] for i in w['items']]) if s['status']==0 else None
    payload={'schema':'decision-service-v1','run_id':rid,'parent_run':parent['run_id'],'parent_sha256':PARENT_SHA,'protocol':cfg,'protocol_sha256':sha(dest/'protocol.json'),'inputs_sha256':sha(dest/'inputs.json'),'orders_sha256':sha(dest/'orders.json'),'code_sha256':{name:sha(ROOT/name) for name in CODE},'audit':load(ROOT/'docs/evaluation/decision-service-audit-v1.json'),'records':records,'notice':parent['notice']}
    save(dest/'case.json',payload);save(ROOT/'artifacts/decision-service-latest.json',{'run_id':rid});publish(dest)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['run','verify']);args=parser.parse_args()
    if args.command=='run':run()
    else:publish(ROOT/'artifacts/decision-service-runs'/load(ROOT/'artifacts/decision-service-latest.json')['run_id'])

"""Read-only audit of frozen R6 scenarios, constraints and known development outcomes."""
import json
from pathlib import Path
import numpy as np
from services.monitoring.common import load, save, sha
from services.decision.core import inputs, metrics
ROOT=Path(__file__).resolve().parents[2]
PARENT_SHA='8041a65adc15f374d7af7191ababaaccb11389e960aa86fe0da82310cb527573'
PARENT_RUN='decision-20261014T024032437273Z'

def source():
    manifest=load(ROOT/'apps/web/decision-results/manifest.json')
    if manifest!={'path':PARENT_SHA[:16]+'/case.json','sha256':PARENT_SHA,'run_id':PARENT_RUN}:raise ValueError('Parent changed')
    path=ROOT/'apps/web/decision-results'/manifest['path']
    if sha(path)!=PARENT_SHA:raise ValueError('Parent bytes changed')
    p=load(path);dest=ROOT/'artifacts/decision-runs'/PARENT_RUN
    for name,key in [('frozen-inputs.json','inputs_sha256'),('frozen-orders.json','frozen_sha256'),('protocol.json','protocol_sha256')]:
        if sha(dest/name)!=p[key]:raise ValueError('Frozen provenance changed')
    for name,digest in p['code_sha256'].items():
        if sha(dest/name)!=digest:raise ValueError('Frozen code changed')
    if sha(ROOT/'services/decision/core.py')!=p['code_sha256']['core.py']:raise ValueError('Calculation code changed')
    before=load(dest/'frozen-inputs.json')
    weekly=ROOT/'artifacts/runs'/p['protocol']['source_run']/'weekly-series.json'
    if sha(weekly)!=p['protocol']['weekly_sha256']:raise ValueError('Weekly source changed')
    rows=load(weekly);by={(r['origin'],r['item']):r for r in rows}
    for w,old in zip(p['windows'],before,strict=True):
        if w['origin']!=old['origin'] or w['end']!=old['end']:raise ValueError('Window changed')
        for r,original in zip(w['items'],old['items'],strict=True):
            if {k:v for k,v in r.items() if k!='actual'}!=original:raise ValueError('Input changed after freeze')
            src=by[w['origin'],r['id']]
            dates=src['history_dates']
            import datetime as dt
            end=dt.date.fromisoformat(w['origin'])
            if dates!=[(end-dt.timedelta(days=56-i)).isoformat() for i in range(56)]:raise ValueError('History not pre-origin')
            np.testing.assert_allclose(np.array(src['history']).reshape(8,7).sum(axis=1),r['weeks'],rtol=0,atol=1e-8)
            for m,v in r['predictions'].items():np.testing.assert_allclose(v,src['predictions'][m])
            np.testing.assert_allclose(r['actual'],src['actual'])
    return p,before

def audit(p):
    c=p['protocol'];out=[]
    for w in p['windows']:
        actual=np.array([r['actual'] for r in w['items']])
        for model in c['forecast_models']:
            plan=next(q for q in w['plans'] if q['model']==model and q['budget_ratio']==1 and q['capacity_ratio']==1.25 and q['shortage_ratio']==1.5)
            x=inputs(w['items'],model,1,1.25,1.5,c);d=x['demand'];totals=d.sum(axis=0)
            # Common columns retain cross-item timing. These are empirical ranges, not confidence intervals.
            row={'origin':w['origin'],'model':model,'scenario_mean':float(d.mean(axis=1).sum()),'actual_total':float(actual.sum()),'scenario_total_min':float(totals.min()),'scenario_total_max':float(totals.max()),'above_item_range':int((actual>d.max(axis=1)).sum()),'below_item_range':int((actual<d.min(axis=1)).sum()),'items':len(actual),'mean_error':float(d.mean(axis=1).sum()-actual.sum()),'default_costs':{}}
            for method,r in plan['policies'].items():row['default_costs'][method]={'expected':r['expected'],'observed':r['observed']}
            row['relaxations']=[]
            for axis,b,k in [('budget',.6,1.25),('capacity',1,.75)]:
                tighter=next(q for q in w['plans'] if q['model']==model and q['budget_ratio']==b and q['capacity_ratio']==k and q['shortage_ratio']==1.5)
                a=tighter['policies']['milp'];z=plan['policies']['milp']
                if z['expected']['total_cost']>a['expected']['total_cost']+max(.1,abs(a['expected']['total_cost'])*2e-6):raise ValueError('Relaxed optimum worse')
                row['relaxations'].append({'axis':axis,'from':b if axis=='budget' else k,'to':1 if axis=='budget' else 1.25,'expected_saving':a['expected']['total_cost']-z['expected']['total_cost'],'observed_saving':a['observed']['total_cost']-z['observed']['total_cost']})
            out.append(row)
        for plan in w['plans']:
            x=inputs(w['items'],plan['model'],plan['budget_ratio'],plan['capacity_ratio'],plan['shortage_ratio'],c)
            for r in plan['policies'].values():
                for kind,target in [('expected',None),('observed',actual)]:
                    got=metrics(x,r['packs'],target)
                    for k,v in got.items():
                        if v is None or isinstance(v,bool):
                            if v!=r[kind][k]:raise ValueError('Metric changed')
                        else:np.testing.assert_allclose(v,r[kind][k],rtol=1e-8,atol=1e-4)
    return {'schema':'decision-service-audit-v1','parent_run':p['run_id'],'parent_sha256':PARENT_SHA,'input_sha256':p['inputs_sha256'],'weekly_sha256':c['weekly_sha256'],'origins':len(p['windows']),'item_windows':sum(len(w['items']) for w in p['windows']),'verified_plans':sum(len(w['plans']) for w in p['windows']),'scenario_count':8,'history_days':56,'rows':out,'scope':'Known development data. Sales proxy; eight synchronized historical weekly blocks scaled to prediction, no calibrated joint coverage. Resource comparisons change one existing bound at a time, no new solving.'}

def main():
    p,_=source();a=audit(p);save(ROOT/'docs/evaluation/decision-service-audit-v1.json',a)
    for model in p['protocol']['forecast_models']:
        r=[x for x in a['rows'] if x['model']==model]
        print(model,json.dumps({'above_item_range':sum(x['above_item_range'] for x in r),'item_windows':144,'mean_demand':sum(x['scenario_mean'] for x in r),'actual':sum(x['actual_total'] for x in r),'above_total_range_windows':sum(x['actual_total']>x['scenario_total_max'] for x in r),'expected_milp_saving':sum(x['default_costs']['point']['expected']['total_cost']-x['default_costs']['milp']['expected']['total_cost'] for x in r),'observed_milp_saving':sum(x['default_costs']['point']['observed']['total_cost']-x['default_costs']['milp']['observed']['total_cost'] for x in r),'relaxations':{axis:{key:sum(next(z for z in x['relaxations'] if z['axis']==axis)[key] for x in r) for key in ['expected_saving','observed_saving']} for axis in ['budget','capacity']}},ensure_ascii=False))
if __name__=='__main__':main()

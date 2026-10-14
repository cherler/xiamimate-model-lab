"""Freeze decisions, then attach known development sales; never refit old forecasts."""
import argparse
import hashlib
import itertools
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd
import scipy
from services.monitoring.common import load, save, sha
from .core import inputs, metrics, rule, optimize, POLICIES

ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'artifacts/decision-runs'
PUBLIC=ROOT/'apps/web/decision-results'
CONFIG=Path(__file__).with_name('protocol.json')


def source(cfg):
    parent=ROOT/'artifacts/runs'/cfg['source_run'];path=parent/'weekly-series.json';cache=ROOT/'data/processed/transactions.csv.gz'
    if sha(path)!=cfg['weekly_sha256'] or sha(cache)!=cfg['transactions_sha256']:raise ValueError('Input version mismatch')
    audit=load(ROOT/'data/processed/audit.json')
    if audit['xlsx_sha256']!=cfg['xlsx_sha256'] or audit['processed_sha256']!=cfg['transactions_sha256']:raise ValueError('Source audit mismatch')
    checksum=load(parent/'checksums.json')
    if checksum['weekly-series.json']!=cfg['weekly_sha256']:raise ValueError('Parent checksum mismatch')
    return load(path),pd.read_csv(cache,dtype={'item':str,'customer':'string','invoice':str},parse_dates=['date']),audit


def prepare(rows, frame, cfg):
    windows=[]
    for origin in sorted({r['origin'] for r in rows}):
        date=pd.Timestamp(origin);past=frame[(frame.country=='United Kingdom')&(frame.date<date)&(frame.date>=date-pd.Timedelta(days=56))]
        items=[]
        for r in sorted((r for r in rows if r['origin']==origin),key=lambda r:r['item']):
            history=np.asarray(r['history'],float);weeks=history.reshape(8,7).sum(axis=1)
            if len(r['history_dates'])!=56 or r['history_dates']!=pd.date_range(date-pd.Timedelta(days=56),periods=56).strftime('%Y-%m-%d').tolist():raise ValueError('Future or missing history')
            part=past[past.item==r['item']];daily=part.groupby(part.date.dt.normalize()).quantity.sum().reindex(pd.date_range(date-pd.Timedelta(days=56),periods=56),fill_value=0)
            np.testing.assert_allclose(daily,history,rtol=0,atol=1e-8)
            if part.empty:raise ValueError('No historical price')
            price=float(part.price.median()*100)
            predictions={m:float(r['predictions'][m]) for m in cfg['forecast_models']}
            np.testing.assert_allclose(predictions['four_week_mean'],weeks[-4:].mean())
            items.append({'id':r['item'],'name':r['name'],'weeks':weeks.tolist(),'price':price,'price_rows':len(part),'cost':max(1,int(np.ceil(price*cfg['purchase_price_ratio']))),
                          'initial':int(np.floor(weeks.mean()*cfg['initial_stock_week_ratio'])),'predictions':predictions})
        windows.append({'origin':origin,'end':str((date+pd.Timedelta(days=6)).date()),'items':items})
    if len(windows)!=12 or any(len(w['items'])!=12 for w in windows):raise ValueError('Incomplete weekly scope')
    return windows


def evaluate(windows, rows, cfg):
    by_key={(r['origin'],r['item']):r for r in rows}
    for w in windows:
        actual=[]
        for item in w['items']:
            r=by_key[w['origin'],item['id']];value=float(r['actual'])
            if value<0 or not np.isclose(sum(r['actual_days']),value):raise ValueError('Invalid actual')
            item['actual']=value;actual.append(value)
        for plan in w['plans']:
            x=inputs(w['items'],plan['model'],plan['budget_ratio'],plan['capacity_ratio'],plan['shortage_ratio'],cfg)
            for result in plan['policies'].values():result['observed']=metrics(x,result['packs'],actual)


def export(dest):
    p=load(dest/'case.json');digest=sha(dest/'case.json');folder=PUBLIC/digest[:16];folder.mkdir(parents=True,exist_ok=True)
    (folder/'case.json').write_bytes((dest/'case.json').read_bytes())
    save(PUBLIC/'manifest.json',{'path':digest[:16]+'/case.json','sha256':digest,'run_id':p['run_id']})
    save(ROOT/'artifacts/decision-latest.json',{'run_id':p['run_id']});print('Exported',p['run_id'],digest,flush=True)


def run():
    cfg=load(CONFIG);rows,frame,audit=source(cfg);windows=prepare(rows,frame,cfg)
    run_id='decision-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');dest=ART/run_id;dest.mkdir(parents=True,exist_ok=False)
    for name in ['protocol.json','core.py','run.py']:(dest/name).write_bytes(Path(__file__).with_name(name).read_bytes())
    save(dest/'frozen-inputs.json',windows);start=time.perf_counter()
    for w in windows:
        plans=[]
        for model,budget,capacity,shortage in itertools.product(cfg['forecast_models'],cfg['budget_ratios'],cfg['capacity_ratios'],cfg['shortage_price_ratios']):
            x=inputs(w['items'],model,budget,capacity,shortage,cfg);policies={}
            for name in ['point','buffer']:
                t=time.perf_counter();packs=rule(x,name=='buffer');policies[name]={'packs':packs.tolist(),'seconds':time.perf_counter()-t}
            policies['milp']=optimize(x,cfg['milp'])
            for name,result in policies.items():
                result['expected']=metrics(x,result['packs'])
                if not result['expected']['feasible']:raise ValueError('Infeasible policy')
                if policies['milp']['objective']>result['expected']['total_cost']+max(.01,1e-6*result['expected']['total_cost']):raise ValueError('Optimization worse than feasible rule')
            plans.append({'model':model,'budget_ratio':budget,'capacity_ratio':capacity,'shortage_ratio':shortage,'budget':x['budget'],'capacity':x['capacity'],'policies':policies})
        w['plans']=plans;print('Solved',w['origin'],len(plans),'configurations',flush=True)
    save(dest/'frozen-orders.json',windows);frozen_sha=sha(dest/'frozen-orders.json');seconds=time.perf_counter()-start
    with (dest/'outcome-access.json').open('x') as f:f.write('known development outcomes attached after orders were saved\n')
    evaluate(windows,rows,cfg)
    payload={'version':'r6-v1','run_id':run_id,'protocol':cfg,'protocol_sha256':sha(dest/'protocol.json'),'frozen_sha256':frozen_sha,'inputs_sha256':sha(dest/'frozen-inputs.json'),
             'code_sha256':{n:sha(dest/n) for n in ['core.py','run.py']},'windows':windows,'audit':audit,'seconds':seconds,'environment':{'python':platform.python_version(),'scipy':scipy.__version__},
             'notice':'Chen, D. (2012). Online Retail II. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D . CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . Source: https://archive.ics.uci.edu/dataset/502/online+retail+ii . Local adaptation: cleaned UK sales, saved weekly forecasts, assumed inventory/costs, scenario optimization and retrospective simulation; not real business profit.'}
    save(dest/'case.json',payload);export(dest)


def verify():
    dest=ART/load(ROOT/'artifacts/decision-latest.json')['run_id'];p=load(dest/'case.json');cfg=p['protocol']
    for f,key in [('protocol.json','protocol_sha256'),('frozen-inputs.json','inputs_sha256'),('frozen-orders.json','frozen_sha256')]:
        if sha(dest/f)!=p[key]:raise ValueError('Frozen artifact changed')
    if load(dest/'protocol.json')!=cfg:raise ValueError('Protocol changed')
    for n,digest in p['code_sha256'].items():
        if sha(dest/n)!=digest:raise ValueError('Code snapshot changed')
    rows,frame,_=source(cfg);before=prepare(rows,frame,cfg)
    if before!=load(dest/'frozen-inputs.json'):raise ValueError('Source inputs changed')
    frozen=load(dest/'frozen-orders.json');evaluate(frozen,rows,cfg)
    if frozen!=p['windows']:raise ValueError('Orders or outcomes changed')
    for w in p['windows']:
        start=pd.Timestamp(w['origin']);part=frame[(frame.country=='United Kingdom')&(frame.date>=start)&(frame.date<start+pd.Timedelta(days=7))].groupby('item').quantity.sum()
        np.testing.assert_allclose([part.get(r['id'],0) for r in w['items']],[r['actual'] for r in w['items']])
        for plan in w['plans']:
            x=inputs(w['items'],plan['model'],plan['budget_ratio'],plan['capacity_ratio'],plan['shortage_ratio'],cfg)
            for name,result in plan['policies'].items():
                if result['expected']!=metrics(x,result['packs']) or not result['expected']['feasible']:raise ValueError('Expected metrics changed')
                if name!='milp' and rule(x,name=='buffer').tolist()!=result['packs']:raise ValueError('Rule changed')
            solved=optimize(x,cfg['milp'])
            np.testing.assert_allclose(solved['objective'],plan['policies']['milp']['objective'],rtol=1e-6,atol=.01)
    export(dest);print('Verified saved orders, source sales, constraints and optimal objectives',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['run','verify']);args=parser.parse_args()
    run() if args.command=='run' else verify()

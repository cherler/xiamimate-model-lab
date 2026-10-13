"""Incremental third round; audited round-two artifacts stay immutable."""
from __future__ import annotations
import os
for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS']:
    os.environ[key]='2'
import hashlib
import json
import shutil
import time
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from scipy import sparse
from prepare_data import ROOT,prepare
from train_v2 import Resources,write_json,mean_windows
from ml.core import build_itemcf,next_baskets
from ml.recommenders import interaction_matrix,fit_als,evaluate,latency,STRATEGIES
from ml.personalized import build_personalized,EXTRA_STRATEGIES,LABELS
from ml.forecasting_v3 import enrich_daily,forecast_diagnostics,train_weekly


def rec_diagnostics(run,contexts,models):
    rows=[]
    for name in models:
        frame=pd.read_csv(run/f'validation-predictions-{name}.csv.gz',dtype={'customer':str})
        for row in frame.to_dict('records'):
            context=contexts[row['origin']]
            target=set(json.loads(row['target']));ranked=set(json.loads(row['ranked']))
            history=set(context['histories'].get(row['customer'],[]));repeat=target & history;novel=target-history
            activity='cold' if not history else '1–5' if len(history)<=5 else '6–20' if len(history)<=20 else '21+'
            basket='1–10' if len(target)<=10 else '11–30' if len(target)<=30 else '31+'
            rows.append({'model':name,'origin':row['origin'],'customer':row['customer'],'activity':activity,'basket':basket,'recall':row['recall'],'ndcg':row['ndcg'],'hit_rate':row['hit_rate'],'precision':len(ranked&target)/10,'ideal_recall':min(10,len(target&context['catalog']))/len(target),'basket_size':len(target),'repeat_share':len(repeat)/len(target),'repeat_recall':len(ranked&repeat)/len(repeat) if repeat else np.nan,'novel_recall':len(ranked&novel)/len(novel) if novel else np.nan})
    frame=pd.DataFrame(rows);frame.to_csv(run/'recommendation-diagnostics.csv.gz',index=False)
    metric_keys=['recall','ndcg','hit_rate','precision','ideal_recall','basket_size','repeat_share','repeat_recall','novel_recall']
    def summary(part):
        return {'rows':len(part),**{k:float(part[k].mean()) if part[k].notna().any() else None for k in metric_keys},'repeat_users':int(part.repeat_recall.notna().sum()),'novel_users':int(part.novel_recall.notna().sum())}
    groups={column:[{'group':group,'models':{name:summary(subset) for name,subset in part.groupby('model')}} for group,part in frame.groupby(column)] for column in ['activity','basket']}
    return {'groups':groups,'overall':{name:summary(part) for name,part in frame.groupby('model')},'definition':'Diagnostics pool customer-window records (headline scores average windows equally). Activity = distinct training catalog items; basket size and repeat/novel targets are retrospective groups. Repeat/novel recall excludes empty denominators; predictions unchanged. Ideal recall is a target-informed upper bound, not a model.'}


def main():
    begun=time.perf_counter();config=json.loads((ROOT/'services/configs/round3.json').read_text())
    parent=ROOT/'artifacts/runs'/config['parent_run_id'];report=json.loads((parent/'report.json').read_text())
    assert report['schema_version']==2,'Third round requires the frozen second-round parent'
    for name,digest in json.loads((parent/'checksums.json').read_text()).items():
        assert hashlib.sha256((parent/name).read_bytes()).hexdigest()==digest,name
    run_id=datetime.now(timezone.utc).strftime('retail-%Y%m%dT%H%M%SZ');run=ROOT/'artifacts/runs'/run_id
    shutil.copytree(parent,run)
    (run/'report.json').rename(run/'parent-report.json');(run/'checksums.json').rename(run/'parent-checksums.json');(run/'source').rename(run/'parent-source')
    write_json(run/'config.json',config)
    data,audit=prepare();assert audit['input_sha256']==report['source']['input_sha256'];write_json(run/'data-audit.json',audit)
    rec=data[data.customer.notna()];summaries={name:{'windows':[],'records':[],'resources':[]} for name in EXTRA_STRATEGIES[:-1]}
    candidates=[{'als_weight':weight,'windows':[],'records':[]} for weight in config['recommendation']['hybrid_als_weights']]
    contexts={}
    for origin in config['origins']:
        print(f'Personal recommendation baselines: {origin}',flush=True)
        train=rec[rec.date<origin];model=build_itemcf(train,**report['config']['recommendation']['itemcf']);users,x=interaction_matrix(model)
        model['users']=users;model['_user_index']={u:i for i,u in enumerate(users)};model['_item_index']={v:i for i,v in enumerate(model['items'])}
        model.update(fit_als(x,report['recommendation']['selected_params']['als'],config['seed'],config['threads']))
        with Resources() as resource:
            model.update(build_personalized(train,users,model['items'],origin,config['recommendation']['decay_days']))
        contexts[origin]={'histories':model['histories'],'catalog':set(model['items'])}
        end=str((pd.Timestamp(origin)+pd.offsets.MonthBegin()).date());targets=next_baskets(rec,origin,end)
        for name,entry in summaries.items():
            metrics,records=evaluate(model,targets,name)
            entry['windows'].append(metrics);entry['records'].append(records);entry['resources'].append(resource.result)
            print(f"  {name}: Recall={metrics['recall']:.4f}, NDCG={metrics['ndcg']:.4f}",flush=True)
        for candidate in candidates:
            model['hybrid_als_weight']=candidate['als_weight'];metrics,records=evaluate(model,targets,'hybrid')
            candidate['windows'].append(metrics);candidate['records'].append(records)
    best=max(candidates,key=lambda e:mean_windows(e['windows'])['ndcg'])
    best['resources']=summaries['personal_decay']['resources'];summaries['hybrid']=best;model['hybrid_als_weight']=best['als_weight']
    metadata=json.loads((run/'model.json').read_text());assert metadata['users']==model['users'] and metadata['items']==model['items']
    metadata.update(schema_version=3,run_id=run_id,hybrid_als_weight=best['als_weight'],decay_days=config['recommendation']['decay_days'])
    write_json(run/'model.json',metadata)
    for key in ['frequency_matrix','recency_matrix','decay_matrix']:sparse.save_npz(run/f'{key}.npz',model[key])
    for old in report['recommendation']['models'].values():old['inherited_from_parent']=True
    for name,entry in summaries.items():
        rows=[{'origin':origin,**r,'target':json.dumps(r['target']),'ranked':json.dumps(r['ranked'])} for origin,group in zip(config['origins'],entry['records']) for r in group]
        pd.DataFrame(rows).to_csv(run/f'validation-predictions-{name}.csv.gz',index=False)
        artifact_files=['decay_matrix.npz','als.npz'] if name=='hybrid' else [{'personal_frequency':'frequency_matrix.npz','personal_recent':'recency_matrix.npz','personal_decay':'decay_matrix.npz'}[name]]
        report['recommendation']['models'][name]={'label':LABELS[name],'metrics':mean_windows(entry['windows']),'windows':[{'origin':origin,**m} for origin,m in zip(config['origins'],entry['windows'])],'resources':entry['resources'],'user_windows':len(rows),'unique_customers':len({row['customer'] for row in rows}),'latency':latency(model,name,users),'model_bytes':sum((run/f).stat().st_size for f in artifact_files),'inherited_from_parent':False}
    report['recommendation']['default_model']=max(report['recommendation']['models'],key=lambda n:report['recommendation']['models'][n]['metrics']['ndcg'])
    report['recommendation']['selected_params']['hybrid']={'als_weight':best['als_weight'],'decay_days':config['recommendation']['decay_days']}
    report['recommendation']['hybrid_candidates']=[{key:val for key,val in e.items() if key not in ['records','resources']} for e in candidates]
    report['recommendation']['resource_note_v3']='Old model costs inherited from round two. New personal baselines share one event aggregation fit; hybrid also requires inherited ALS. Timings are not additive.'
    diagnostics={'recommendation':rec_diagnostics(run,contexts,[*STRATEGIES,*EXTRA_STRATEGIES])}
    del contexts,summaries,candidates,model,x
    with Resources() as resource:
        series=json.loads((parent/'forecast-series.json').read_text())
        report['forecast'],series=enrich_daily(data,run,config,report['forecast'],series)
        diagnostics['forecast']=forecast_diagnostics(series,report['forecast']['models'])
        report['weekly']=train_weekly(data,run,config)
    report['third_round_forecast_resources']=resource.result
    write_json(run/'diagnostics.json',diagnostics)
    report.update(schema_version=3,run_id=run_id,parent_run_id=config['parent_run_id'],config=config,generated_at=datetime.now(timezone.utc).isoformat(),evidence_level='development_validation')
    report['limitations']+=['Round three reuses fixed second-round outputs after checksum verification; new models use identical old-task labels.','Weekly totals use a new update schedule and target; never compare their WAPE directly as daily-task improvement.']
    report['code_sha256']={}
    for path in [*sorted((ROOT/'services').glob('*.py')),*sorted((ROOT/'services/ml').glob('*.py')),ROOT/'services/configs/round3.json',ROOT/'uv.lock',ROOT/'pyproject.toml']:
        dest=run/'source'/path.relative_to(ROOT);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest);report['code_sha256'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
    report['duration_seconds']=round(time.perf_counter()-begun,2)
    write_json(run/'report.json',report)
    write_json(run/'checksums.json',{str(p.relative_to(run)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(run.rglob('*')) if p.is_file()})
    temp=ROOT/'artifacts/latest.json.tmp';write_json(temp,{'run_id':run_id});temp.replace(ROOT/'artifacts/latest.json')
    print(f'Complete {run_id}, {report["duration_seconds"]}s, recommendation={report["recommendation"]["default_model"]}, weekly gate={report["weekly"]["gate"]}',flush=True)


if __name__=='__main__':main()

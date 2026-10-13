"""Source-based verification of all third-round additions and immutable inheritance."""
import os
for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS']:os.environ[key]='2'
import hashlib
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services'))
import numpy as np
import pandas as pd
from lightgbm import Booster
from server import Artifacts
from prepare_data import prepare,ROOT
from ml.core import build_itemcf,next_baskets
from ml.recommenders import interaction_matrix,fit_als,evaluate,STRATEGIES
from ml.personalized import build_personalized,EXTRA_STRATEGIES
from ml.forecasting import forecast_metrics
from ml.forecasting_v2 import dataset
from ml.forecasting_v3 import enriched_features,daily_training,weekly_features,weekly_training,estimator,forecast_diagnostics
from train_v3 import rec_diagnostics

store=Artifacts().load();run,r=store.run,store.report;assert r['schema_version']==3
config=r['config'];parent=ROOT/'artifacts/runs'/r['parent_run_id'];parent_report=json.loads((parent/'report.json').read_text())
for directory in [parent,run]:
    for name,digest in json.loads((directory/'checksums.json').read_text()).items():assert hashlib.sha256((directory/name).read_bytes()).hexdigest()==digest,name
for name in [*[f'validation-predictions-{s}.csv.gz' for s in STRATEGIES],'als.npz','ease.npy','itemcf.npz','popularity.npy']:
    assert (run/name).read_bytes()==(parent/name).read_bytes(),name
new_daily=pd.read_csv(run/'forecast-predictions.csv.gz',dtype={'item':str});old_daily=pd.read_csv(parent/'forecast-predictions.csv.gz',dtype={'item':str})
pd.testing.assert_frame_equal(new_daily[old_daily.columns],old_daily)
data,audit=prepare();assert audit['input_sha256']==r['source']['input_sha256'];contexts={}
for origin in config['origins']:
    train=data[(data.date<origin)&data.customer.notna()]
    model=build_itemcf(train,**parent_report['config']['recommendation']['itemcf']);users,x=interaction_matrix(model)
    model.update(users=users,_user_index={u:i for i,u in enumerate(users)},hybrid_als_weight=r['recommendation']['selected_params']['hybrid']['als_weight'])
    model.update(fit_als(x,r['recommendation']['selected_params']['als'],config['seed'],config['threads']))
    model.update(build_personalized(train,users,model['items'],origin,config['recommendation']['decay_days']))
    contexts[origin]={'histories':model['histories'],'catalog':set(model['items'])}
    targets=next_baskets(data,origin,str((pd.Timestamp(origin)+pd.offsets.MonthBegin()).date()))
    for name in EXTRA_STRATEGIES:
        metrics,records=evaluate(model,targets,name)
        saved=pd.read_csv(run/f'validation-predictions-{name}.csv.gz',dtype={'customer':str});saved=saved[saved.origin==origin]
        assert len(records)==len(saved)
        for observed,stored in zip(records,saved.to_dict('records')):
            assert observed['customer']==stored['customer']
            assert observed['target']==json.loads(stored['target'])
            assert observed['ranked']==json.loads(stored['ranked'])
        expected=next(w for w in r['recommendation']['models'][name]['windows'] if w['origin']==origin)
        for metric in ['recall','ndcg','hit_rate','catalog_coverage','target_catalog_coverage']:assert abs(metrics[metric]-expected[metric])<1e-10
        headline=r['recommendation']['models'][name]['metrics']
        for metric in headline:assert abs(np.mean([w[metric] for w in r['recommendation']['models'][name]['windows']])-headline[metric])<1e-10
        if origin==store.model['as_of']:
            loaded_metrics,loaded_records=evaluate(store.model,targets,name)
            assert [v['ranked'] for v in records]==[v['ranked'] for v in loaded_records]
    print(f'Four personalized methods refit/replayed: {origin}',flush=True)
# Recompute diagnostics without modifying the immutable run.
import tempfile
with tempfile.TemporaryDirectory() as directory:
    scratch=Path(directory)
    for name in STRATEGIES+EXTRA_STRATEGIES:(scratch/f'validation-predictions-{name}.csv.gz').symlink_to(run/f'validation-predictions-{name}.csv.gz')
    computed=rec_diagnostics(scratch,contexts,STRATEGIES+EXTRA_STRATEGIES)
    assert computed==store.diagnostics['recommendation']
uk,items,dates,values=dataset(data,config)
assert len(new_daily)==1008
for name,result in r['forecast']['models'].items():
    for metric,value in forecast_metrics(new_daily.actual,new_daily[name]).items():assert abs(value-result['metrics'][metric])<1e-9
for origin in config['origins']:
    start=int(dates.get_loc(pd.Timestamp(origin)));x,y=daily_training(values,dates,start)
    query=np.array([enriched_features(s,dates,start,h,i,len(items)) for i,s in enumerate(values) for h in range(1,29)])
    for name,objective,log in [('lgbm_history_l1','regression_l1',False),('lgbm_history_l2','regression',False),('lgbm_history_log','regression',True)]:
        trained=estimator(config,objective,config['forecast']['num_leaves']).fit(x,np.log1p(y) if log else y)
        replay=trained.booster_.predict(query);loaded=Booster(model_file=str(run/f'forecast-{name}-{origin}.txt')).predict(query)
        np.testing.assert_allclose(replay,loaded,atol=1e-8)
        replay=np.maximum(0,np.expm1(replay) if log else replay).reshape(len(items),28)
        for i,item in enumerate(items):
            s=next(s for s in store.forecast if s['item']==item and s['origin']==origin)
            np.testing.assert_allclose(s['predictions'][name],replay[i],atol=1e-8)
    for i,item in enumerate(items):
        s=next(s for s in store.forecast if s['item']==item and s['origin']==origin)
        np.testing.assert_array_equal(s['actual'],values[i,start:start+28])
        assert s['spike_threshold']==np.quantile(values[i,:start],.95)
        expected={'zero':np.zeros(28),'mean28':np.repeat(values[i,start-28:start].mean(),28),'median28':np.repeat(np.median(values[i,start-28:start]),28),'weekday_median':np.tile(np.median(values[i,start-56:start].reshape(8,7),axis=0),4)}
        for name,prediction in expected.items():np.testing.assert_allclose(s['predictions'][name],prediction)
        for name in r['forecast']['models']:
            subset=new_daily[(new_daily.origin==origin)&(new_daily.item==item)]
            np.testing.assert_allclose(subset[name],s['predictions'][name],atol=1e-8)
            for key,value in forecast_metrics(s['actual'],s['predictions'][name]).items():assert abs(value-s['metrics'][name][key])<1e-9
    print(f'Enriched daily models refit/replayed: {origin}',flush=True)
assert forecast_diagnostics(store.forecast,r['forecast']['models'])==store.diagnostics['forecast']
f=pd.read_csv(run/'weekly-predictions.csv.gz',dtype={'item':str});assert len(f)==144 and not f.duplicated(['item','origin']).any()
for origin in r['weekly']['origins']:
    start=int(dates.get_loc(pd.Timestamp(origin)));x,y=weekly_training(values,dates,start,config['forecast']['weekly_training_stride'])
    query=np.array([weekly_features(v,dates,start,i,len(items)) for i,v in enumerate(values)])
    params=r['weekly']['selected_params'];refit=estimator(config,params['objective'],params['num_leaves']).fit(x,y)
    prediction=np.maximum(0,refit.booster_.predict(query));reloaded=np.maximum(0,Booster(model_file=str(run/f'weekly-lightgbm-{origin}.txt')).predict(query));np.testing.assert_allclose(prediction,reloaded,atol=1e-8)
    stat=json.loads((run/f'weekly-autoets-{origin}.json').read_text());np.testing.assert_array_equal(stat['histories'],values[:,:start])
    for i,item in enumerate(items):
        row=next(s for s in store.weekly if s['item']==item and s['origin']==origin)
        assert row['actual']==values[i,start:start+7].sum();np.testing.assert_array_equal(row['history'],values[i,start-56:start]);np.testing.assert_allclose(row['predictions']['lightgbm'],prediction[i],atol=1e-8)
        weeks=values[i,start-28:start].reshape(4,7).sum(axis=1)
        baselines={'zero':0,'last_week':weeks[-1],'four_week_mean':weeks.mean(),'four_week_median':np.median(weeks),'autoets':sum(stat['result'][i]['prediction']) if stat['result'][i]['prediction'] is not None else weeks[-1]}
        for name,value in baselines.items():np.testing.assert_allclose(row['predictions'][name],value,atol=1e-8)
        saved=f[(f.item==item)&(f.origin==origin)].iloc[0]
        for name in r['weekly']['models']:np.testing.assert_allclose(saved[name],row['predictions'][name],atol=1e-8)
    window=next(w for w in r['weekly']['windows'] if w['origin']==origin);part=f[f.origin==origin]
    for name in r['weekly']['models']:
        for metric,value in forecast_metrics(part.actual,part[name]).items():assert abs(value-window['models'][name][metric])<1e-9
    print(f'Weekly total model refit/replayed: {origin}',flush=True)
for name,model in r['weekly']['models'].items():
    for metric,value in forecast_metrics(f.actual,f[name]).items():assert abs(value-model['metrics'][metric])<1e-9
weekly=r['weekly'];baseline=min((name for name in weekly['models'] if name!='lightgbm'),key=lambda n:weekly['models'][n]['metrics']['wape'])
assert baseline==weekly['gate']['best_baseline']
gain=1-weekly['models']['lightgbm']['metrics']['wape']/weekly['models'][baseline]['metrics']['wape'];assert gain==weekly['gate']['wape_gain']
wins=sum(w['models']['lightgbm']['wape']<w['models'][baseline]['wape'] for w in weekly['windows']);assert wins==weekly['gate']['winning_windows']
g=config['forecast']['development_gate'];checks={'bias':abs(weekly['models']['lightgbm']['metrics']['bias'])<=g['maximum_absolute_bias'],'wape_gain':gain>=g['minimum_wape_gain_vs_best_baseline'],'winning_windows':wins>=g['minimum_winning_windows']};assert checks==weekly['gate']['checks'];assert all(checks.values())==weekly['gate']['passed']
print(f'All inherited checksums, targets, refits, diagnostics and screening checks passed: {store.run_id}')

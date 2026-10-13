"""Round-three diagnostics and separately defined 7-day total-sales experiment."""
from __future__ import annotations
import json
import time
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from ml.forecasting import features, forecast_metrics, training_origins
from ml.forecasting_v2 import dataset, statistical

DAILY_LABELS = {'zero':'全部预测为零', 'mean28':'近28天日均值', 'median28':'近28天日中位数', 'weekday_median':'近8周同星期中位数', 'lgbm_history_l1':'丰富历史 LightGBM · L1', 'lgbm_history_l2':'丰富历史 LightGBM · L2', 'lgbm_history_log':'丰富历史 LightGBM · log-L2'}
WEEKLY_LABELS = {'zero':'全部预测为零', 'last_week':'上周总销量', 'four_week_mean':'近四周周均值', 'four_week_median':'近四周周中位数', 'autoets':'AutoETS · 7日合计', 'lightgbm':'直接预测7日总量 · LightGBM'}


def enriched_features(values, dates, origin, horizon, item_index, item_count):
    past = np.asarray(values[:origin], dtype=float)
    same_weekday = past[-56:][(np.arange(-56, 0) - (horizon-1)) % 7 == 0]
    positive = np.flatnonzero(past[-56:] > 0)
    age = 55-int(positive[-1]) if len(positive) else 56
    extra = [np.log1p(same_weekday.mean()), np.log1p(np.median(same_weekday)), float((past[-28:] == 0).mean()), float((same_weekday == 0).mean()), np.log1p(past[-28:].max()), np.log1p(past[-28:].min()), age/56]
    return features(values, dates, origin, horizon, item_index, item_count) + extra


def daily_training(values, dates, stop):
    x,y=[],[]
    for i, series in enumerate(values):
        for origin in training_origins(stop):
            for h in range(1,29):
                x.append(enriched_features(series,dates,origin,h,i,len(values)))
                y.append(series[origin+h-1])
    return np.array(x),np.array(y)


def weekly_features(values, dates, origin, item_index, item_count):
    if origin < 56:
        raise ValueError('At least 56 observed days required')
    past=np.asarray(values[:origin],dtype=float)
    weeks=past[-56:].reshape(8,7).sum(axis=1)
    date=dates[origin]
    stats=[*weeks[-4:],weeks[-4:].mean(),np.median(weeks[-4:]),weeks.mean(),weeks.std(),past[-28:].max(),past[-28:].mean(),np.median(past[-28:])]
    extra=[float((past[-28:]==0).mean()),float((past[-7:]==0).mean()),weeks[-1]/max(weeks[-4:].mean(),1),np.sin(2*np.pi*date.month/12),np.cos(2*np.pi*date.month/12),np.sin(2*np.pi*date.dayofweek/7),np.cos(2*np.pi*date.dayofweek/7)]
    return np.log1p(stats).tolist()+extra+[float(i==item_index) for i in range(item_count)]


def weekly_training(values,dates,stop,stride=1):
    x,y=[],[]
    for i,series in enumerate(values):
        for origin in range(56,stop-7+1,stride):
            x.append(weekly_features(series,dates,origin,i,len(values)))
            y.append(series[origin:origin+7].sum())
    return np.array(x),np.array(y)


def estimator(config,objective,leaves):
    return LGBMRegressor(objective=objective,num_leaves=leaves,n_estimators=config['forecast']['n_estimators'],learning_rate=.05,min_child_samples=30,reg_lambda=1.,random_state=config['seed'],n_jobs=config['threads'],deterministic=True,force_col_wise=True,verbosity=-1)


def enrich_daily(data,run,config,parent_summary,series):
    uk,items,dates,values=dataset(data,config)
    times={name:0. for name in DAILY_LABELS}
    for origin in config['origins']:
        print(f'28-day enriched features: {origin}',flush=True)
        start=int(dates.get_loc(pd.Timestamp(origin)))
        x,y=daily_training(values,dates,start)
        query=np.array([enriched_features(s,dates,start,h,i,len(items)) for i,s in enumerate(values) for h in range(1,29)])
        shape=(len(items),28)
        predictions={
            'zero':np.zeros(shape),
            'mean28':np.repeat(values[:,start-28:start].mean(axis=1)[:,None],28,axis=1),
            'median28':np.repeat(np.median(values[:,start-28:start],axis=1)[:,None],28,axis=1),
            'weekday_median':np.tile(np.median(values[:,start-56:start].reshape(len(items),8,7),axis=1),(1,4))
        }
        for name,objective,log in [('lgbm_history_l1','regression_l1',False),('lgbm_history_l2','regression',False),('lgbm_history_log','regression',True)]:
            started=time.perf_counter()
            model=estimator(config,objective,config['forecast']['num_leaves']).fit(x,np.log1p(y) if log else y)
            times[name]+=time.perf_counter()-started
            pred=model.booster_.predict(query)
            predictions[name]=np.maximum(0,np.expm1(pred) if log else pred).reshape(shape)
            model.booster_.save_model(str(run/f'forecast-{name}-{origin}.txt'))
        for i,item in enumerate(items):
            row=next(s for s in series if s['origin']==origin and s['item']==item)
            for name,prediction in predictions.items():
                row['predictions'][name]=prediction[i].tolist()
                row['metrics'][name]=forecast_metrics(row['actual'],prediction[i])
            row['spike_threshold']=float(np.quantile(values[i,:start],config['forecast']['diagnostic_spike_quantile']))
    rows=[{'item':s['item'],'origin':s['origin'],'date':date,'actual':s['actual'][h],**{name:prediction[h] for name,prediction in s['predictions'].items()}} for s in series for h,date in enumerate(s['dates'])]
    frame=pd.DataFrame(rows); frame.to_csv(run/'forecast-predictions.csv.gz',index=False)
    (run/'forecast-series.json').write_text(json.dumps(series,ensure_ascii=False,allow_nan=False))
    summary=json.loads(json.dumps(parent_summary))
    for old in summary['models'].values():old['inherited_from_parent']=True
    for name,label in DAILY_LABELS.items():
        summary['models'][name]={'label':label,'metrics':forecast_metrics(frame.actual,frame[name]),'training_seconds':times[name] if name.startswith('lgbm') else None,'fallback_series':0,'inherited_from_parent':False}
    summary['default_model']=min(summary['models'],key=lambda n:summary['models'][n]['metrics']['wape'])
    for window in summary['windows']:
        part=frame[frame.origin==window['origin']]
        window['models']={name:forecast_metrics(part.actual,part[name]) for name in summary['models']}
    summary['third_round_features']=['56-day matching-weekday mean and median','28-day and same-weekday zero shares','28-day max/min','days since a positive sale (censored at 56)']
    summary['third_round_protocol']='Same 28-day labels, SKU catalog and sample origins as round two; L1/L2/log-L2 share enriched features; no post-hoc row deletion.'
    return summary,series


def forecast_diagnostics(series,model_names):
    rows=[]
    for s in series:
        for h,actual in enumerate(s['actual']):
            group='zero' if actual==0 else 'spike' if actual>s['spike_threshold'] else 'regular'
            rows.append({'item':s['item'],'origin':s['origin'],'actual':actual,'group':group,**{name:s['predictions'][name][h] for name in model_names}})
    frame=pd.DataFrame(rows)
    def entries(column):
        result=[]
        for group,part in frame.groupby(column,sort=True):
            result.append({'group':str(group),'rows':len(part),'actual_sum':float(part.actual.sum()),'zero_fraction':float((part.actual==0).mean()),'models':{name:{**forecast_metrics(part.actual,part[name]),'absolute_error_sum':float(np.abs(part.actual-part[name]).sum()),'share_of_model_error':float(np.abs(part.actual-part[name]).sum()/max(np.abs(frame.actual-frame[name]).sum(),1e-12))} for name in model_names}})
        return result
    return {'by_item':entries('item'),'by_demand':entries('group'),'by_origin':entries('origin'),'definition':'Retrospective error attribution. Spike = actual daily quantity above that SKU/window training-history 95th percentile. Zero groups have undefined WAPE. No rows removed.'}


def train_weekly(data,run,config):
    uk,items,dates,values=dataset(data,config)
    origins=[str((pd.Timestamp(origin)+pd.Timedelta(days=offset)).date()) for origin in config['origins'] for offset in config['forecast']['weekly_offsets']]
    candidates=[{'objective':o,'num_leaves':leaves} for o in config['forecast']['weekly_objectives'] for leaves in config['forecast']['weekly_leaves']]
    evaluations=[{'params':p,'windows':[],'predictions':[],'training_seconds':0.} for p in candidates]
    cache=[];failures=[];baseline_times={name:0. for name in WEEKLY_LABELS if name!='lightgbm'}
    for origin in origins:
        print(f'7-day total experiment: {origin}',flush=True)
        start=int(dates.get_loc(pd.Timestamp(origin)))
        x,y=weekly_training(values,dates,start,config['forecast']['weekly_training_stride'])
        query=np.array([weekly_features(v,dates,start,i,len(items)) for i,v in enumerate(values)])
        actual=values[:,start:start+7].sum(axis=1)
        weeks=values[:,start-28:start].reshape(len(items),4,7).sum(axis=2)
        predictions={'zero':np.zeros(len(items)),'last_week':weeks[:,-1],'four_week_mean':weeks.mean(axis=1),'four_week_median':np.median(weeks,axis=1)}
        began=time.perf_counter();stat=statistical('autoets',values[:,:start].tolist(),7,config['forecast']['statistical_timeout_seconds']);baseline_times['autoets']+=time.perf_counter()-began
        ets=[]
        for i,row in enumerate(stat):
            if row['prediction'] is None:
                failures.append({'origin':origin,'item':items[i],'model':'autoets','reason':row['failure'],'fallback':'last_week'})
                ets.append(predictions['last_week'][i])
            else:ets.append(sum(row['prediction']))
        predictions['autoets']=np.array(ets)
        (run/f'weekly-autoets-{origin}.json').write_text(json.dumps({'histories':values[:,:start].tolist(),'horizon':7,'result':stat},allow_nan=False))
        fitted=[]
        for candidate,entry in zip(candidates,evaluations):
            began=time.perf_counter();model=estimator(config,candidate['objective'],candidate['num_leaves']).fit(x,y);entry['training_seconds']+=time.perf_counter()-began
            pred=np.maximum(0,model.booster_.predict(query))
            entry['windows'].append({'origin':origin,**forecast_metrics(actual,pred)});entry['predictions'].extend(pred.tolist());fitted.append(model)
        cache.append((origin,start,actual,predictions,fitted,len(x)))
    all_actual=np.concatenate([v[2] for v in cache])
    for entry in evaluations:entry['metrics']=forecast_metrics(all_actual,entry['predictions'])
    selected=min(range(len(evaluations)),key=lambda i:evaluations[i]['metrics']['wape'])
    rows,series,windows=[],[],[]
    for origin,start,actual,predictions,fitted,n in cache:
        model=fitted[selected];predictions['lightgbm']=np.maximum(0,model.booster_.predict(np.array([weekly_features(v,dates,start,i,len(items)) for i,v in enumerate(values)])))
        model.booster_.save_model(str(run/f'weekly-lightgbm-{origin}.txt'))
        windows.append({'origin':origin,'end':str(dates[start+6].date()),'training_examples':n,'models':{name:forecast_metrics(actual,pred) for name,pred in predictions.items()}})
        descriptions=uk[uk.day<origin].sort_values('date').drop_duplicates('item',keep='last').set_index('item')['name'].to_dict()
        for i,item in enumerate(items):
            record={'item':item,'origin':origin,'end':str(dates[start+6].date()),'actual':float(actual[i]),**{name:float(pred[i]) for name,pred in predictions.items()}}
            rows.append(record)
            series.append({'item':item,'name':descriptions.get(item,item),'origin':origin,'end':record['end'],'history_dates':[str(d.date()) for d in dates[start-56:start]],'history':values[i,start-56:start].tolist(),'actual':float(actual[i]),'actual_days':values[i,start:start+7].tolist(),'predictions':{name:float(pred[i]) for name,pred in predictions.items()},'fallback_models':['autoets'] if any(f['origin']==origin and f['item']==item for f in failures) else []})
    frame=pd.DataFrame(rows);frame.to_csv(run/'weekly-predictions.csv.gz',index=False)
    (run/'weekly-series.json').write_text(json.dumps(series,ensure_ascii=False,allow_nan=False))
    models={name:{'label':label,'metrics':forecast_metrics(frame.actual,frame[name]),'training_seconds':evaluations[selected]['training_seconds'] if name=='lightgbm' else baseline_times[name] if name=='autoets' else None,'fallback_series':len(failures) if name=='autoets' else 0} for name,label in WEEKLY_LABELS.items()}
    baseline=min((name for name in models if name!='lightgbm'),key=lambda n:models[n]['metrics']['wape'])
    gain=1-models['lightgbm']['metrics']['wape']/models[baseline]['metrics']['wape']
    wins=sum(w['models']['lightgbm']['wape']<w['models'][baseline]['wape'] for w in windows)
    limits=config['forecast']['development_gate']
    checks={'bias':abs(models['lightgbm']['metrics']['bias'])<=limits['maximum_absolute_bias'],'wape_gain':gain>=limits['minimum_wape_gain_vs_best_baseline'],'winning_windows':wins>=limits['minimum_winning_windows']}
    for entry in evaluations:entry.pop('predictions')
    return {'task':'Predict next 7 calendar days total units, refit every 7 days within each development month; separate from 28-day daily forecasting.','origins':origins,'windows':windows,'items':items,'rows_evaluated':len(rows),'models':models,'default_model':min(models,key=lambda n:models[n]['metrics']['wape']),'selected_params':candidates[selected],'candidates':evaluations,'fallbacks':failures,'gate':{'passed':all(checks.values()),'checks':checks,'thresholds':limits,'best_baseline':baseline,'wape_gain':gain,'winning_windows':wins,'note':config['forecast']['gate_note']},'evidence_level':'development_validation','limitations':['Same public data and known development periods; no unseen test.','Both aggregation and update frequency changed; not an improvement percentage over 28-day daily WAPE.','7-day totals have no within-week allocation or calibrated interval; do not invent daily predictions from totals.']}

"""Causal anomaly features, unsupervised calibration, and event-level alert replay."""
import json
import platform
import time
import urllib.request
import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score
from sklearn.preprocessing import RobustScaler
from .common import ROOT, CONFIG, load, save, sha, create_run, export

METHODS = ['static','rolling','isolation']
NAMES = {'ambient_temperature_system_failure':'办公室温度', 'machine_temperature_system_failure':'设备内部温度', 'cpu_utilization_asg_misconfiguration':'自动扩缩容 CPU'}


def causal_features(times, values, floor):
    s = pd.Series(values, index=pd.DatetimeIndex(times))
    history = s.rolling('24h', closed='left', min_periods=12)
    mean, std, median = history.mean(), history.std(ddof=0), history.median()
    mad = history.apply(lambda v: np.median(np.abs(v-np.median(v))), raw=True)
    features = np.column_stack([values, s.diff(), mean, std, s-mean])
    rolling = np.abs(s-median).to_numpy()/np.maximum(1.4826*mad.to_numpy(),floor)
    return features, rolling, median.to_numpy()


def evaluate(rows, windows, model, threshold, cooldown=60):
    if not np.isfinite(threshold) or threshold < 0 or not np.isfinite(cooldown) or cooldown < 0:
        raise ValueError('Invalid alert policy')
    times = np.array([r['t'] for r in rows]); scores = np.array([r['scores'][model] for r in rows])
    labels = np.array([any(w['start'] <= t <= w['end'] for w in windows) for t in times])
    flags = scores > threshold
    tp = int((flags & labels).sum()); fp = int((flags & ~labels).sum()); fn = int((~flags & labels).sum()); tn = int((~flags & ~labels).sum())
    alerts=[]; last=-float('inf')
    for i in np.flatnonzero(flags):
        if times[i]-last >= cooldown*60000:
            matches=[j for j,w in enumerate(windows) if w['start']<=times[i]<=w['end']]
            alerts.append({'i':int(i),'t':int(times[i]),'event':matches[0] if matches else None}); last=times[i]
    events=[]
    for j,w in enumerate(windows):
        hits=[a for a in alerts if a['event']==j]
        events.append({'detected':bool(hits),'first_alert':hits[0]['t'] if hits else None,'delay_minutes':float((hits[0]['t']-w['start'])/60000) if hits else None,'alerts':len(hits)})
    false=sum(a['event'] is None for a in alerts); detected=sum(e['detected'] for e in events)
    days=float((times[-1]-times[0]+np.median(np.diff(times)))/86400000)
    return {'tp':tp,'fp':fp,'fn':fn,'tn':tn,'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,'fpr':fp/(fp+tn) if fp+tn else None,
            'ap':float(average_precision_score(labels,scores)) if labels.any() else None,'alert_count':len(alerts),'false_alerts':false,'false_alerts_per_day':false/days,'observed_span_days':days,
            'detected_events':detected,'event_count':len(windows),'event_recall':detected/len(windows) if windows else None,'alert_precision':(len(alerts)-false)/len(alerts) if alerts else None,
            'duplicate_event_alerts':len(alerts)-false-detected,'median_delay_minutes':float(np.median([e['delay_minutes'] for e in events if e['detected']])) if detected else None,'events':events,'alerts':alerts}


def run():
    cfg=load(CONFIG);raw=ROOT/'data/raw/r5';raw.mkdir(parents=True,exist_ok=True)
    for name,digest in cfg['nab']['files'].items():
        path=raw/name.split('/')[-1]
        if not path.exists():
            urllib.request.urlretrieve(f"https://raw.githubusercontent.com/numenta/NAB/{cfg['nab']['revision']}/{name}",path)
        if sha(path)!=digest:raise ValueError('NAB source mismatch: '+name)
    run_id,dest=create_run('anomaly');series=[];models={};started=time.perf_counter()
    for name in cfg['anomaly']['series']:
        frame=pd.read_csv(raw/(name+'.csv'));raw_rows=len(frame);frame['timestamp']=pd.to_datetime(frame.timestamp)
        source_ordered=bool(frame.timestamp.is_monotonic_increasing);frame=frame.drop_duplicates('timestamp',keep='first').sort_values('timestamp',kind='stable').reset_index(drop=True)
        dates=frame.timestamp;values=frame.value.to_numpy(float)
        if not dates.is_monotonic_increasing or dates.duplicated().any() or not np.isfinite(values).all():raise ValueError('Invalid series')
        n=len(values);train_end=int(n*.2);cal_end=int(n*.3)
        train=values[:train_end];median=np.median(train);floor=max(float(np.subtract(*np.percentile(train,[75,25])))*.01,1e-8)
        static=np.abs(values-median)/max(float(1.4826*np.median(np.abs(train-median))),floor)
        X,rolling,historical=causal_features(dates,values,floor);valid=np.isfinite(X).all(axis=1)&np.isfinite(rolling)
        fit=valid & (np.arange(n)<train_end);cal=valid & (np.arange(n)>=train_end)&(np.arange(n)<cal_end)
        scaler=RobustScaler().fit(X[fit]);forest=IsolationForest(**cfg['anomaly']['isolation_forest'],random_state=cfg['seed']).fit(scaler.transform(X[fit]))
        isolation=np.full(n,np.nan);isolation[valid]=-forest.score_samples(scaler.transform(X[valid]));scores=dict(zip(METHODS,[static,rolling,isolation]))
        thresholds={m:float(np.quantile(scores[m][cal],.99,method='higher')) for m in METHODS}
        rows=[]
        for i in range(n):
            rows.append({'t':int(dates.iloc[i].value//1000000),'v':float(values[i]),'split':'train' if i<train_end else 'calibration' if i<cal_end else 'evaluation',
                         'scores':{m:float(scores[m][i]) for m in METHODS} if valid[i] else None,'features':X[i].tolist() if valid[i] else None,'past_median':float(historical[i]) if np.isfinite(historical[i]) else None})
        item={'id':name,'name':NAMES[name],'rows':rows,'train_end':train_end,'cal_end':cal_end,'thresholds':thresholds,'train_median':float(median),'scale_floor':floor,
              'fit_rows':int(fit.sum()),'calibration_rows':int(cal.sum()),'evaluation_rows':int((valid&(np.arange(n)>=cal_end)).sum()),'source_sha256':sha(raw/(name+'.csv')),'raw_rows':raw_rows,'duplicate_timestamps_removed':raw_rows-n,'source_chronological':source_ordered}
        models[name]={'scaler':scaler,'isolation_forest':forest};series.append(item)
    joblib.dump(models,dest/'models.joblib');save(dest/'frozen-scores.json',series)
    frozen_sha=sha(dest/'frozen-scores.json')
    # First relevance-window parse occurs only after all models/scores/thresholds are saved.
    with (dest/'label-access.json').open('x') as f:json.dump({'status':'opened','frozen_sha256':frozen_sha},f)
    windows=load(raw/'combined_windows.json')
    for item in series:
        evaluation=[r for r in item['rows'] if r['split']=='evaluation' and r['scores'] is not None]
        start,end=evaluation[0]['t'],evaluation[-1]['t'];selected=[]
        source=windows['realKnownCause/'+item['id']+'.csv']
        for a,b in source:
            x,y=int(pd.Timestamp(a).value//1000000),int(pd.Timestamp(b).value//1000000)
            if y>=start and x<=end:selected.append({'start':max(x,start),'end':min(y,end),'original_start':x,'original_end':y,'clipped':x<start or y>end})
        item['windows']=selected;item['source_event_count']=len(source)
        item['metrics']={m:evaluate(evaluation,selected,m,item['thresholds'][m]) for m in METHODS}
    access={'status':'completed','frozen_sha256':frozen_sha};save(dest/'label-access.json',access)
    payload={'kind':'anomaly','run_id':run_id,'protocol':cfg,'protocol_sha256':sha(dest/'protocol.json'),'frozen_sha256':frozen_sha,'access':access,'series':series,
             'seconds':time.perf_counter()-started,'model_sha256':sha(dest/'models.joblib'),'environment':{'python':platform.python_version(),'sklearn':sklearn.__version__},
             'notice':'NAB — Ahmad, Lavin, Purdy & Agha (2017), Unsupervised real-time anomaly detection for streaming data. https://doi.org/10.1016/j.neucom.2017.04.070\nhttps://github.com/numenta/NAB\nLocal adaptation: causal features, fixed thresholds, alert replay and custom metrics; not official NAB scores.\n'+(raw/'LICENSE.txt').read_text()}
    save(dest/'case.json',payload);export('anomaly',dest)
    print(json.dumps({s['id']:{m:{k:v for k,v in r.items() if k not in ['events','alerts']} for m,r in s['metrics'].items()} for s in series},indent=2))


if __name__=='__main__':run()

"""Prepare shared past-only inputs; replay preparation requires a frozen selection."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2');os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import torch  # initialize before ranking imports LightGBM
import json
import pickle
import time
import numpy as np
import pandas as pd
from common import load_data,write
from forecast import prepare_series
from ranking import build_snapshot,make_queries
from automl.features import forecast_features


def forecast_inputs(frame, cfg, origins, training):
    dates=pd.date_range(cfg['train_start'],frame.date.max());items=sorted(frame.item.unique());rows=[];x=[];y=[];trainx=[];trainy=[]
    for idx,item in enumerate(items):
        f=frame[frame.item==item].sort_values('time_idx');v=f.quantity.to_numpy();price=float(f.log_price.iloc[0])
        if training:
            stop=int((pd.Timestamp(cfg['train_end'])-dates[0]).days)
            for start in range(56,stop-7+1,7):
                for h in range(1,8):
                    trainx.append(forecast_features(v[:start],h,dates[start+h-1],price,idx,len(items)));trainy.append(v[start+h-1])
        for origin in origins:
            start=int((pd.Timestamp(origin)-dates[0]).days);hist=v[:start]
            for h in range(1,8):
                x.append(forecast_features(hist,h,dates[start+h-1],price,idx,len(items)));y.append(v[start+h-1])
                rows.append(dict(origin=origin,item=item,date=str(dates[start+h-1].date()),actual=float(v[start+h-1]),last_week=float(hist[-7:][h-1]),weekday_median=float(np.median(hist[-56:].reshape(8,7),axis=0)[h-1])))
    return dict(x=np.array(x),y=np.array(y),train_x=np.array(trainx),train_y=np.array(trainy)),rows,items


def main(run,phase):
    spec=json.loads((run/'config.json').read_text());cfg=spec['base'];config=spec['config'];data,source=load_data();t=time.perf_counter()
    if phase=='validation':
        data=data[data.date<pd.Timestamp('2011-09-01')].copy();training=[]
        for origin in ['2011-06-01','2011-07-01']:
            s=build_snapshot(data,origin,cfg['recommendation']);q,_=make_queries(data,s,cfg['recommendation']);training.extend(q)
        s=build_snapshot(data,'2011-08-01',cfg['recommendation']);q,cohort=make_queries(data,s,cfg['recommendation'])
        with (run/'recommendation-inputs.pkl').open('wb') as f:pickle.dump(dict(snapshot=s,queries=q,training=training,cohort=cohort),f)
        origins=config['validation_origins']
    else:
        if not (run/'selection.json').exists():raise ValueError('Replay requires frozen selection')
        origins=cfg['forecast']['evaluation_origins']
    frame,names=prepare_series(data,cfg['forecast'])
    if phase=='validation':frame=frame[frame.date<pd.Timestamp('2011-09-01')].copy()
    frame.to_pickle(run/f'forecast-{phase}.pkl')
    inputs,rows,items=forecast_inputs(frame,cfg['forecast'],origins,phase=='validation')
    np.savez_compressed(run/f'forecast-{phase}.npz',**inputs)
    write(run/f'forecast-{phase}-rows.json',rows)
    write(run/f'preparation-{phase}.json',dict(seconds=time.perf_counter()-t,source=source,items=items,names=names))
if __name__=='__main__':main(Path(sys.argv[1]),sys.argv[2])

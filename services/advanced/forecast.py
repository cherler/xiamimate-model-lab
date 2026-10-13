"""Actual Temporal Fusion Transformer with train-only normalization and held-forward inputs."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2')
os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
from pathlib import Path
import json
import pickle
import time
import numpy as np
import pandas as pd
import torch
import lightning.pytorch as pl
from lightning.pytorch.callbacks import ModelCheckpoint,EarlyStopping
from pytorch_forecasting import TimeSeriesDataSet,TemporalFusionTransformer
from pytorch_forecasting.data import GroupNormalizer
from pytorch_forecasting.metrics import QuantileLoss
import subprocess
import sys
from common import CONFIG,ROOT,finish,forecasts_metrics,load_data,new_run,write

KNOWN=['time_scaled','weekday_sin','weekday_cos','month_sin','month_cos']

def prepare_series(data,cfg):
    past=data[(data.date>=pd.Timestamp(cfg['train_start']))&(data.date<pd.Timestamp(cfg['train_end']))].copy()
    past['day']=past.date.dt.normalize();support=past.groupby('item').agg(active=('day','nunique'),units=('quantity','sum'))
    items=support[support.active>=cfg['minimum_active_days']].reset_index().sort_values(['units','item'],ascending=[False,True]).head(cfg['items']).item.tolist()
    if len(items)!=cfg['items']:raise ValueError('Insufficient train-only items')
    metadata=past.sort_values('date').drop_duplicates('item',keep='last').set_index('item')['name'].to_dict();price=past.groupby('item').price.median().to_dict()
    end=pd.Timestamp(cfg['evaluation_origins'][-1])+pd.Timedelta(days=cfg['horizon']-1);dates=pd.date_range(cfg['train_start'],end)
    relevant=data[data.item.isin(items)].copy();relevant['day']=relevant.date.dt.normalize();daily=relevant.groupby(['item','day']).quantity.sum()
    frames=[]
    for item in sorted(items):
        frame=pd.DataFrame({'date':dates,'item':item,'time_idx':np.arange(len(dates)),'quantity':daily.get(item,pd.Series(dtype=float)).reindex(dates,fill_value=0).to_numpy(dtype=float),'log_price':np.log1p(price[item])})
        frame['time_scaled']=frame.time_idx/365
        frame['weekday_sin']=np.sin(2*np.pi*frame.date.dt.dayofweek/7);frame['weekday_cos']=np.cos(2*np.pi*frame.date.dt.dayofweek/7)
        frame['month_sin']=np.sin(2*np.pi*frame.date.dt.month/12);frame['month_cos']=np.cos(2*np.pi*frame.date.dt.month/12);frames.append(frame)
    return pd.concat(frames,ignore_index=True),metadata

def prediction_frame(frame,origin,cfg,placeholder=0.):
    start=pd.Timestamp(origin);end=start+pd.Timedelta(days=cfg['horizon']);lower=start-pd.Timedelta(days=cfg['encoder_days'])
    query=frame[(frame.date>=lower)&(frame.date<end)].copy()
    # Only the observed encoder history is retained. Targets for scoring live elsewhere.
    query.loc[query.date>=start,'quantity']=placeholder
    return query

def tree_features(history,horizon,date,price,item_index,item_count):
    history=np.asarray(history);weekday=history[-56:][(np.arange(-56,0)-(horizon-1))%7==0]
    stats=[history[-1],history[-7],history[-14],history[-28],history[-7:].mean(),history[-28:].mean(),history[-56:].mean(),history[-28:].std(),history[-28:].max(),np.median(weekday),weekday.mean()]
    return [*np.log1p(stats),horizon/7,float((history[-28:]==0).mean()),np.sin(2*np.pi*date.dayofweek/7),np.cos(2*np.pi*date.dayofweek/7),np.sin(2*np.pi*date.month/12),np.cos(2*np.pi*date.month/12),price,*[float(i==item_index) for i in range(item_count)]]

def quantile_metrics(actual,quantiles,levels):
    y=np.asarray(actual);q=np.asarray(quantiles);delta=y[:,None]-q
    return {'pinball':{str(level):float(np.maximum(level*delta[:,i],(level-1)*delta[:,i]).mean()) for i,level in enumerate(levels)},'coverage':float(np.mean((y>=q[:,0])&(y<=q[:,-1]))),'mean_width':float(np.mean(q[:,-1]-q[:,0])),'nominal_coverage':levels[-1]-levels[0]}

class TrainingTrace(pl.Callback):
    def __init__(self):self.rows=[]
    def on_validation_epoch_end(self,trainer,model):
        if trainer.sanity_checking:return
        self.rows.append({'epoch':int(trainer.current_epoch),'validation_loss':float(trainer.callback_metrics['val_loss'])})

def main():
    config=json.loads(CONFIG.read_text());cfg=config['forecast'];torch.set_num_threads(config['threads']);pl.seed_everything(config['seed'],workers=True)
    data,source=load_data();frame,names=prepare_series(data,cfg);run=new_run('tft',config);start=time.perf_counter();train=frame[frame.date<pd.Timestamp(cfg['train_end'])].copy();validation=frame[frame.date<pd.Timestamp(cfg['validation_end'])].copy()
    traincut=int((pd.Timestamp(cfg['train_end'])-pd.Timestamp(cfg['train_start'])).days)
    training=TimeSeriesDataSet(train,time_idx='time_idx',target='quantity',group_ids=['item'],max_encoder_length=cfg['encoder_days'],min_encoder_length=cfg['encoder_days'],max_prediction_length=cfg['horizon'],min_prediction_length=cfg['horizon'],static_categoricals=['item'],static_reals=['log_price'],time_varying_known_reals=KNOWN,time_varying_unknown_reals=['quantity'],target_normalizer=GroupNormalizer(groups=['item'],transformation='softplus'),add_relative_time_idx=True,add_target_scales=True,add_encoder_length=False,randomize_length=False)
    valid=TimeSeriesDataSet.from_dataset(training,validation,min_prediction_idx=traincut,stop_randomization=True)
    trainloader=training.to_dataloader(train=True,batch_size=cfg['batch_size'],num_workers=0,drop_last=False);valloader=valid.to_dataloader(train=False,batch_size=cfg['batch_size'],num_workers=0)
    model=TemporalFusionTransformer.from_dataset(training,learning_rate=cfg['learning_rate'],hidden_size=cfg['hidden_size'],attention_head_size=cfg['attention_heads'],dropout=.1,hidden_continuous_size=8,output_size=len(cfg['quantiles']),loss=QuantileLoss(quantiles=cfg['quantiles']),optimizer='adam',reduce_on_plateau_patience=3,log_interval=-1)
    assert 'quantity' not in model.hparams.time_varying_reals_decoder
    checkpoint=ModelCheckpoint(dirpath=run/'checkpoints',filename='best',monitor='val_loss',mode='min',save_top_k=1);trace=TrainingTrace()
    trainer=pl.Trainer(max_epochs=cfg['epochs'],accelerator='cpu',devices=1,logger=False,enable_progress_bar=False,enable_model_summary=False,gradient_clip_val=.1,callbacks=[checkpoint,EarlyStopping(monitor='val_loss',patience=4,mode='min'),trace],deterministic=True,num_sanity_val_steps=0)
    print('Train actual TFT',len(training),'sequences',flush=True);trainer.fit(model,train_dataloaders=trainloader,val_dataloaders=valloader)
    # Trusted, locally generated Lightning checkpoint; retain full dataset preprocessing.
    best=TemporalFusionTransformer.load_from_checkpoint(checkpoint.best_model_path,map_location='cpu',weights_only=False);best.eval()
    with (run/'dataset-parameters.pkl').open('wb') as f:pickle.dump(training.get_parameters(),f,protocol=5)
    x=[];y=[];items=sorted(frame.item.unique());dates=pd.date_range(cfg['train_start'],frame.date.max());trainstop=len(dates[dates<pd.Timestamp(cfg['train_end'])]);series={item:frame[frame.item==item].sort_values('time_idx') for item in items}
    for idx,item in enumerate(items):
        v=series[item].quantity.to_numpy();price=float(series[item].log_price.iloc[0])
        for origin in range(cfg['encoder_days'],trainstop-cfg['horizon']+1,7):
            for h in range(1,cfg['horizon']+1):x.append(tree_features(v[:origin],h,dates[origin+h-1],price,idx,len(items)));y.append(v[origin+h-1])
    evaluation=[]
    for origin in cfg['evaluation_origins']:
        startidx=int((pd.Timestamp(origin)-dates[0]).days)
        for idx,item in enumerate(items):
            hist=series[item].quantity.to_numpy()[:startidx];price=float(series[item].log_price.iloc[0])
            evaluation.extend(tree_features(hist,h,dates[startidx+h-1],price,idx,len(items)) for h in range(1,cfg['horizon']+1))
    np.savez_compressed(run/'tree-inputs.npz',x=np.array(x),y=np.array(y),evaluation=np.array(evaluation))
    print('Train same-scope LightGBM in isolated process',flush=True)
    subprocess.run([sys.executable,str(Path(__file__).with_name('forecast_tree.py')),str(run),str(config['seed']),str(config['threads'])],check=True,timeout=180)
    tree_predictions=np.load(run/'tree-predictions.npy').reshape(len(cfg['evaluation_origins']),len(items),cfg['horizon'])
    tree_reload_error=json.loads((run/'tree-reload.json').read_text())['max_error']
    def predict(query):
        ds=TimeSeriesDataSet.from_dataset(training,query,predict=True,stop_randomization=True)
        pred=best.predict(ds.to_dataloader(train=False,batch_size=cfg['batch_size'],num_workers=0),mode='quantiles',return_index=True,trainer_kwargs={'accelerator':'cpu','devices':1,'logger':False,'enable_progress_bar':False})
        return {str(item):q for item,q in zip(pred.index['item'],pred.output.detach().cpu().numpy())}
    rows=[];samples=[];leakage_error=0.;crossings=0
    for origin_index,origin in enumerate(cfg['evaluation_origins']):
        print('Evaluate TFT',origin,flush=True);forecast=predict(prediction_frame(frame,origin,cfg));poisoned=predict(prediction_frame(frame,origin,cfg,999999.))
        for item in items:leakage_error=max(leakage_error,float(np.abs(forecast[item]-poisoned[item]).max()))
        assert leakage_error<1e-5,'Decoder unknown targets affected prediction'
        startidx=int((pd.Timestamp(origin)-dates[0]).days)
        for idx,item in enumerate(items):
            hist=series[item].quantity.to_numpy()[:startidx];actual=series[item].quantity.to_numpy()[startidx:startidx+cfg['horizon']];price=float(series[item].log_price.iloc[0]);rawq=np.maximum(0,forecast[item]);crossings+=int(np.any(np.diff(rawq,axis=1)<0,axis=1).sum());q=np.sort(rawq,axis=1)
            baseline=hist[-7:];weekday=np.median(hist[-56:].reshape(8,7),axis=0)
            lgbm=tree_predictions[origin_index,idx]
            for day in range(cfg['horizon']):rows.append({'origin':origin,'item':item,'date':str(dates[startidx+day].date()),'actual':float(actual[day]),'last_week':float(baseline[day]),'weekday_median':float(weekday[day]),'lightgbm':float(lgbm[day]),'tft':float(q[day,1]),'q10':float(q[day,0]),'q90':float(q[day,2])})
            samples.append({'origin':origin,'item':item,'name':names[item],'history':hist[-56:].tolist(),'actual':actual.tolist(),'predictions':{'last_week':baseline.tolist(),'weekday_median':weekday.tolist(),'lightgbm':lgbm.tolist(),'tft':q[:,1].tolist()},'q10':q[:,0].tolist(),'q90':q[:,2].tolist()})
    scored=pd.DataFrame(rows);y=scored.actual.to_numpy();methods=['last_week','weekday_median','lightgbm','tft'];aggregate={m:forecasts_metrics(y,scored[m]) for m in methods};windows=[{'origin':origin,'models':{m:forecasts_metrics(g.actual,g[m]) for m in methods}} for origin,g in scored.groupby('origin')]
    report={'source':source,'task':'seven_day_daily_forecast','scope':'24 train-selected UK products; frozen model fitted before August; August early stopping; three 7-day development origins; 504 product-days','items':items,'rows':len(rows),'windows':windows,'aggregate':aggregate,'interval':quantile_metrics(y,scored[['q10','tft','q90']].to_numpy(),cfg['quantiles']),'raw_crossed_rows':crossings,'decoder_target_invariance_max_error':leakage_error,'tree_reload_max_error':tree_reload_error,'architecture':{'implementation':'pytorch_forecasting.TemporalFusionTransformer','parameters':sum(p.numel() for p in best.parameters()),'encoder_days':cfg['encoder_days'],'horizon':cfg['horizon'],'static':['item','train_only_log_median_price'],'known_future':KNOWN,'observed_only':['quantity'],'decoder_reals':list(best.hparams.time_varying_reals_decoder),'loss':'QuantileLoss 0.1/0.5/0.9','config':cfg},'training_sequences':len(training),'validation_sequences':len(valid),'training_trace':trace.rows,'best_validation_loss':float(checkpoint.best_model_score),'checkpoint':str(Path(checkpoint.best_model_path).relative_to(run)),'duration_seconds':time.perf_counter()-start,'limitations':['Quantiles are clipped nonnegative and monotonically rearranged; empirical coverage is reported, not guaranteed.','Daily marginal interval endpoints must not be summed and called a calibrated weekly interval.','Limited CPU development budget; one TFT seed, no generalization claim across seasons or datasets.','Missing transaction days are filled with zero; inventory constraints and promotions are unavailable.']}
    write(run/'predictions.json',rows);write(run/'samples.json',samples);finish(run,report,'tft');print(run,flush=True)
if __name__=='__main__':
    main()

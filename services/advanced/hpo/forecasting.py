"""TFT Optuna adapter: optimize August MAE, freeze, then replay saved cohort."""
import gc
import json
import pickle
import shutil
from pathlib import Path
import numpy as np
import pandas as pd
import torch
import lightning.pytorch as pl
from lightning.pytorch.callbacks import ModelCheckpoint,EarlyStopping
from pytorch_forecasting import TimeSeriesDataSet,TemporalFusionTransformer
from pytorch_forecasting.data import GroupNormalizer
from pytorch_forecasting.metrics import QuantileLoss,MAE
import optuna
from common import load_data,write,forecasts_metrics
from forecast import KNOWN,prepare_series,prediction_frame,quantile_metrics

LAGS=['log_lag7','log_lag14','log_lag28','log_mean28_shift7']


def add_lags(frame):
    frame=frame.sort_values(['item','time_idx']).copy()
    for lag in [7,14,28]:frame[f'log_lag{lag}']=np.log1p(frame.groupby('item').quantity.shift(lag).fillna(0))
    frame['log_mean28_shift7']=np.log1p(frame.groupby('item').quantity.transform(lambda s:s.shift(7).rolling(28,min_periods=1).mean()).fillna(0))
    return frame


class SearchTrace(pl.Callback):
    def __init__(self,trial,path):self.trial=trial;self.path=path;self.rows=[]
    def on_validation_epoch_end(self,trainer,module):
        if trainer.sanity_checking:return
        value=float(trainer.callback_metrics['val_MAE']);epoch=trainer.current_epoch+1
        self.rows.append({'epoch':epoch,'validation_mae':value,'validation_pinball_x2':float(trainer.callback_metrics['val_loss'])})
        write(self.path/'trace.json',self.rows)
        if self.trial:
            self.trial.report(value,epoch)
            if self.trial.should_prune():raise optuna.TrialPruned()


class ForecastAdapter:
    def __init__(self,path,config,base,parent):
        self.path=path;self.config=config;self.cfg=base['forecast'];self.parent=parent;self.space=config['search_spaces']['tft']
        data,self.source=load_data();self.frame,self.names=prepare_series(data,self.cfg);self.frame=add_lags(self.frame)
        self.train=self.frame[self.frame.date<pd.Timestamp(config['forecast']['train_end'])].copy()
        self.valid=self.frame[self.frame.date<pd.Timestamp(config['forecast']['validation_end'])].copy()
        self.cut=int((pd.Timestamp(config['forecast']['train_end'])-pd.Timestamp(self.cfg['train_start'])).days)
        torch.set_num_threads(config['threads'])

    def initial(self):
        return [{'hidden_size':16,'encoder_days':56,'learning_rate':.005,'dropout':.1,'normalization':'softplus','lag_features':False,'batch_size':128},{'hidden_size':32,'encoder_days':56,'learning_rate':.001,'dropout':.1,'normalization':'linear','lag_features':True,'batch_size':128}]

    def dataset(self,p):
        return TimeSeriesDataSet(self.train,time_idx='time_idx',target='quantity',group_ids=['item'],max_encoder_length=p['encoder_days'],min_encoder_length=p['encoder_days'],max_prediction_length=7,min_prediction_length=7,static_categoricals=['item'],static_reals=['log_price'],time_varying_known_reals=KNOWN+(LAGS if p['lag_features'] else []),time_varying_unknown_reals=['quantity'],target_normalizer=GroupNormalizer(groups=['item'],transformation=None if p['normalization']=='linear' else 'softplus'),add_relative_time_idx=True,add_target_scales=True,add_encoder_length=False,randomize_length=False)

    def objective(self,trial):
        s=self.space;p={k:trial.suggest_categorical(k,s[k]) for k in ['hidden_size','encoder_days','normalization','lag_features','batch_size']}
        p.update(learning_rate=trial.suggest_float('learning_rate',*s['learning_rate'],log=True),dropout=trial.suggest_float('dropout',*s['dropout']))
        d=self.path/f'trial-{trial.number:04d}';d.mkdir(exist_ok=True);pl.seed_everything(self.config['seed'],workers=True)
        training=self.dataset(p);validation=TimeSeriesDataSet.from_dataset(training,self.valid,min_prediction_idx=self.cut,stop_randomization=True)
        model=TemporalFusionTransformer.from_dataset(training,learning_rate=p['learning_rate'],hidden_size=p['hidden_size'],attention_head_size=2,dropout=p['dropout'],hidden_continuous_size=min(16,p['hidden_size']),output_size=3,loss=QuantileLoss(quantiles=[.1,.5,.9]),logging_metrics=torch.nn.ModuleList([MAE()]),optimizer='adam',reduce_on_plateau_patience=5,log_interval=-1)
        assert 'quantity' not in model.hparams.time_varying_reals_decoder
        checkpoint=ModelCheckpoint(dirpath=d/'checkpoints',filename='best',monitor='val_MAE',mode='min',save_top_k=1);trace=SearchTrace(trial,d)
        trainer=pl.Trainer(max_epochs=self.config['forecast']['epochs'],accelerator='cpu',devices=1,logger=False,enable_progress_bar=False,enable_model_summary=False,gradient_clip_val=.1,callbacks=[checkpoint,EarlyStopping(monitor='val_MAE',patience=self.config['forecast']['patience'],mode='min'),trace],deterministic=True,num_sanity_val_steps=0)
        try:
            trainer.fit(model,train_dataloaders=training.to_dataloader(train=True,batch_size=p['batch_size'],num_workers=0,drop_last=False),val_dataloaders=validation.to_dataloader(train=False,batch_size=p['batch_size'],num_workers=0))
            raw=torch.load(checkpoint.best_model_path,map_location='cpu',weights_only=False)
            trial.set_user_attr('best_epoch',int(raw['epoch'])+1);trial.set_user_attr('checkpoint',str(Path(checkpoint.best_model_path).relative_to(self.path)));trial.set_user_attr('epochs_run',len(trace.rows));trial.set_user_attr('training_sequences',len(training));trial.set_user_attr('validation_sequences',len(validation));trial.set_user_attr('parameters',sum(p.numel() for p in model.parameters()))
            with (d/'dataset.pkl').open('wb') as f:pickle.dump(training.get_parameters(),f)
            return float(checkpoint.best_model_score)
        finally:
            del model,trainer;gc.collect()

    def evaluate_selected(self,selection,run):
        from verify import verify_tft
        baseline=verify_tft(self.parent['tft']);p=selection['params'];checkpoint=self.path/selection['attrs']['checkpoint'];shutil.copy2(checkpoint,run/'model.ckpt');shutil.copy2(checkpoint.parents[1]/'dataset.pkl',run/'dataset.pkl')
        with (run/'dataset.pkl').open('rb') as f:parameters=pickle.load(f)
        model=TemporalFusionTransformer.load_from_checkpoint(str(run/'model.ckpt'),map_location='cpu',weights_only=False);model.eval()
        def predict(frame):
            ds=TimeSeriesDataSet.from_parameters(parameters,frame,predict=True,stop_randomization=True)
            out=model.predict(ds.to_dataloader(train=False,batch_size=128,num_workers=0),mode='quantiles',return_index=True,trainer_kwargs={'accelerator':'cpu','devices':1,'logger':False,'enable_progress_bar':False})
            return {str(i):q for i,q in zip(out.index['item'],out.output.detach().numpy())}
        rows=[];samples=[];error=0.;crossings=0
        oldrows=json.loads((self.parent['tft']/'predictions.json').read_text());old={(r['origin'],r['item'],r['date']):r for r in oldrows};oldsample={(s['origin'],s['item']):s for s in json.loads((self.parent['tft']/'samples.json').read_text())}
        for origin in self.cfg['evaluation_origins']:
            print('Replay frozen TFT',origin,flush=True);cfg={**self.cfg,'encoder_days':p['encoder_days']};pred=predict(prediction_frame(self.frame,origin,cfg));poison=predict(prediction_frame(self.frame,origin,cfg,999999.))
            for item,raw in pred.items():
                error=max(error,float(np.max(np.abs(raw-poison[item]))));assert error<1e-5
                q=np.sort(np.maximum(0,raw),axis=1);crossings+=int(np.any(np.diff(raw,axis=1)<0,axis=1).sum());sample=oldsample[(origin,item)];sample['predictions']['tft_tuned']=q[:,1].tolist();sample['tuned_q10']=q[:,0].tolist();sample['tuned_q90']=q[:,2].tolist();samples.append(sample)
                for i,date in enumerate(pd.date_range(origin,periods=7)):
                    row=old[(origin,item,str(date.date()))].copy();row.update(tft_tuned=float(q[i,1]),tuned_q10=float(q[i,0]),tuned_q90=float(q[i,2]));rows.append(row)
        scored=pd.DataFrame(rows);methods=['last_week','weekday_median','lightgbm','tft','tft_tuned'];metrics={m:forecasts_metrics(scored.actual,scored[m]) for m in methods};windows=[{'origin':o,'models':{m:forecasts_metrics(g.actual,g[m]) for m in methods}} for o,g in scored.groupby('origin')]
        write(run/'predictions.json',rows);write(run/'samples.json',samples)
        return {'source':self.source,'task':'seven_day_daily_forecast','parent_tft':baseline['run_id'],'aggregate':metrics,'baseline':baseline['aggregate'],'windows':windows,'rows':len(rows),'items':baseline['items'],'interval':quantile_metrics(scored.actual,scored[['tuned_q10','tft_tuned','tuned_q90']],[.1,.5,.9]),'baseline_interval':baseline['interval'],'raw_crossed_rows':crossings,'decoder_target_invariance_max_error':error,'sample_model':'tft_tuned','architecture':{'parameters':selection['attrs']['parameters'],'encoder_days':p['encoder_days'],'horizon':7,'known_future':KNOWN+(LAGS if p['lag_features'] else []),'decoder_reals':list(model.hparams.time_varying_reals_decoder),'normalization':p['normalization']},'limitations':['August MAE over fixed overlapping seven-day validation sequences selects all hyperparameters and checkpoints; this is not September-November replay selection.','Lag features have minimum lag 7 and are known for the entire seven-day horizon. No future actual quantity or price is read.','P10/P50/P90 are clipped and monotonically rearranged; coverage is empirical, not a guarantee.','Only one tuning seed for TFT; search budget and validation overfitting limit conclusions.']}

"""Fresh fixed-configuration TFT fit for the common cross-family validation cohort."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2');os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import json
import pickle
import time
import numpy as np
import pandas as pd
import torch
import lightning.pytorch as pl
from pytorch_forecasting import TimeSeriesDataSet,TemporalFusionTransformer
from pytorch_forecasting.data import GroupNormalizer
from pytorch_forecasting.metrics import QuantileLoss
from common import write,forecasts_metrics
from forecast import KNOWN,prediction_frame,quantile_metrics
from hpo.forecasting import add_lags,LAGS


class FixedEpochTFT(TemporalFusionTransformer):
    """Fixed learning rate and epoch count: no validation-dependent scheduler."""
    def configure_optimizers(self):
        return torch.optim.Adam(self.parameters(),lr=self.hparams.learning_rate)


def main(run,phase):
    spec=json.loads((run/'config.json').read_text());p=spec['fixed_parameters']['tft']['params'];cfg=spec['base']['forecast'];epochs=spec['fixed_parameters']['tft']['attrs']['best_epoch'];torch.set_num_threads(spec['config']['threads'])
    if phase=='replay':
        selection=json.loads((run/'selection.json').read_text())['forecast']
        if 'tft' not in (selection['accuracy'],selection['efficient']):return
    d=run/'models'/'forecast-tft';d.mkdir(exist_ok=True,parents=True);frame=add_lags(pd.read_pickle(run/f'forecast-{phase}.pkl'))
    t=time.perf_counter()
    if phase=='validation':
        pl.seed_everything(spec['config']['seed'],workers=True)
        training=TimeSeriesDataSet(frame[frame.date<pd.Timestamp(cfg['train_end'])],time_idx='time_idx',target='quantity',group_ids=['item'],max_encoder_length=p['encoder_days'],min_encoder_length=p['encoder_days'],max_prediction_length=7,min_prediction_length=7,static_categoricals=['item'],static_reals=['log_price'],time_varying_known_reals=KNOWN+(LAGS if p['lag_features'] else []),time_varying_unknown_reals=['quantity'],target_normalizer=GroupNormalizer(groups=['item'],transformation=None if p['normalization']=='linear' else 'softplus'),add_relative_time_idx=True,add_target_scales=True,add_encoder_length=False,randomize_length=False)
        model=FixedEpochTFT.from_dataset(training,learning_rate=p['learning_rate'],hidden_size=p['hidden_size'],attention_head_size=2,dropout=p['dropout'],hidden_continuous_size=min(16,p['hidden_size']),output_size=3,loss=QuantileLoss(quantiles=[.1,.5,.9]),optimizer='adam',reduce_on_plateau_patience=None,log_interval=-1)
        trainer=pl.Trainer(max_epochs=epochs,accelerator='cpu',devices=1,logger=False,enable_progress_bar=False,enable_model_summary=False,enable_checkpointing=False,gradient_clip_val=.1,deterministic=True,num_sanity_val_steps=0,limit_val_batches=0)
        trainer.fit(model,train_dataloaders=training.to_dataloader(train=True,batch_size=p['batch_size'],num_workers=0,drop_last=False));trainer.save_checkpoint(d/'model.ckpt')
        parameters=training.get_parameters()
        with (d/'dataset.pkl').open('wb') as f:pickle.dump(parameters,f)
    else:
        with (d/'dataset.pkl').open('rb') as f:parameters=pickle.load(f)
    # Scoring always uses a reloaded model, including validation.
    model=FixedEpochTFT.load_from_checkpoint(str(d/'model.ckpt'),map_location='cpu',weights_only=False);model.eval();preparation_seconds=time.perf_counter()-t;training_seconds=preparation_seconds if phase=='validation' else 0.;loading_seconds=preparation_seconds if phase!='validation' else 0.
    assert 'quantity' not in model.hparams.time_varying_reals_decoder
    if phase=='validation':parameters=training.get_parameters()
    origins=spec['config']['validation_origins'] if phase=='validation' else cfg['evaluation_origins'];prediction={};scoring=0.;error=0.
    def predict(origin,placeholder=0.):
        query=prediction_frame(frame,origin,{**cfg,'encoder_days':p['encoder_days']},placeholder)
        dataset=TimeSeriesDataSet.from_parameters(parameters,query,predict=True,stop_randomization=True)
        out=model.predict(dataset.to_dataloader(train=False,batch_size=128,num_workers=0),mode='quantiles',return_index=True,trainer_kwargs={'accelerator':'cpu','devices':1,'logger':False,'enable_progress_bar':False})
        return {str(item):q for item,q in zip(out.index['item'],out.output.detach().numpy())}
    for origin in origins:
        t=time.perf_counter();raw=predict(origin);scoring+=time.perf_counter()-t;poison=predict(origin,999999.)
        for item,q in raw.items():
            error=max(error,float(np.abs(q-poison[item]).max()));q=np.sort(np.maximum(0,q),axis=1)
            for day in range(7):prediction[(origin,item,str((pd.Timestamp(origin)+pd.Timedelta(days=day)).date()))]=q[day]
    assert error<1e-5
    rows=json.loads((run/f'forecast-{phase}-rows.json').read_text());records=[]
    for row in rows:
        q=prediction[(row['origin'],row['item'],row['date'])];records.append({**row,'prediction':float(q[1]),'q10':float(q[0]),'q90':float(q[2])})
    write(d/f'{phase}.json',records);y=[r['actual'] for r in records];metrics=forecasts_metrics(y,[r['prediction'] for r in records])
    result=dict(id='tft',state='COMPLETE',task='forecast',split=phase,value=metrics['wape'],metrics=metrics,training_seconds=training_seconds,loading_seconds=loading_seconds,scoring_seconds=scoring,cost_seconds=training_seconds+scoring,family='TFT',features=['item','train_log_price','encoder_quantity',*KNOWN,*(LAGS if p['lag_features'] else [])],epochs=epochs,decoder_target_invariance_max_error=error,interval=quantile_metrics(y,[[r['q10'],r['prediction'],r['q90']] for r in records],[.1,.5,.9]))
    write(run/f'forecast-tft-{phase}.json',result)
if __name__=='__main__':main(Path(sys.argv[1]),sys.argv[2])

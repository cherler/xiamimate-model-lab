"""CPU baselines / tree feature search, isolated from Torch's native runtime."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2');os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import json
import pickle
import time
import numpy as np
from lightgbm import LGBMRegressor,Booster
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from common import write,forecasts_metrics
from automl.features import forecast_columns,STAT_NAMES,CAL_NAMES


def main(run,phase):
    spec=json.loads((run/'config.json').read_text());config=spec['config'];inputs=np.load(run/f'forecast-{phase}.npz');rows=json.loads((run/f'forecast-{phase}-rows.json').read_text());items=json.loads((run/f'preparation-{phase}.json').read_text())['items']
    ids=[id for id in config['forecast_candidates'] if id!='tft'] if phase=='validation' else sorted(set(json.loads((run/'selection.json').read_text())['forecast'][k] for k in ['accuracy','efficient'])-{'tft'})
    results=[]
    for id in ids:
        print(phase,'forecast',id,flush=True);d=run/'models'/('forecast-'+id);d.mkdir(exist_ok=True,parents=True)
        try:
            t=time.perf_counter();group=id.split('_',1)[-1] if id not in ('last_week','weekday_median') else None
            if group:
                columns=forecast_columns(group,len(items))
                if phase=='validation':
                    if id.startswith('lgbm'):
                        model=LGBMRegressor(**config['forecast_tree'],random_state=config['seed'],n_jobs=config['threads'],verbosity=-1,deterministic=True,force_col_wise=True).fit(inputs['train_x'][:,columns],inputs['train_y']);model.booster_.save_model(str(d/'model.txt'));model=Booster(model_file=str(d/'model.txt'))
                    else:
                        model=make_pipeline(StandardScaler(),Ridge(alpha=config['ridge_alpha'])).fit(inputs['train_x'][:,columns],inputs['train_y'])
                        with (d/'model.pkl').open('wb') as f:pickle.dump(model,f)
                elif id.startswith('lgbm'):model=Booster(model_file=str(d/'model.txt'))
                else:
                    with (d/'model.pkl').open('rb') as f:model=pickle.load(f)
            preparation=time.perf_counter()-t;training=preparation if phase=='validation' else 0.;loading=preparation if phase!='validation' else 0.;t=time.perf_counter()
            if not group:prediction=np.array([r[id] for r in rows])
            elif id.startswith('lgbm'):prediction=np.maximum(0,model.predict(inputs['x'][:,columns],num_threads=config['threads']))
            else:prediction=np.maximum(0,model.predict(inputs['x'][:,columns]))
            scoring=time.perf_counter()-t;metrics=forecasts_metrics(inputs['y'],prediction);records=[{**r,'prediction':float(p)} for r,p in zip(rows,prediction)];write(d/f'{phase}.json',records)
            features=([STAT_NAMES+CAL_NAMES+['train_log_price']+[f'item:{item}' for item in items]][0] if group else [])
            results.append(dict(id=id,state='COMPLETE',task='forecast',split=phase,value=metrics['wape'],metrics=metrics,training_seconds=training,loading_seconds=loading,scoring_seconds=scoring,cost_seconds=training+scoring,feature_group=group or 'seasonal_rule',family='LightGBM' if id.startswith('lgbm') else 'Ridge' if id.startswith('ridge') else 'Seasonal',features=[features[i] for i in columns] if group else ['past_7_days' if id=='last_week' else 'past_8_matching_weekdays']))
        except Exception as e:
            if phase!='validation':raise
            results.append(dict(id=id,state='FAIL',task='forecast',split=phase,failure=f'{type(e).__name__}: {e}'))
    write(run/f'forecast-trees-{phase}.json',results)
if __name__=='__main__':main(Path(sys.argv[1]),sys.argv[2])

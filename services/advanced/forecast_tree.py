"""Separate process prevents Torch/LightGBM OpenMP runtime conflicts on macOS."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2')
import sys
import json
from pathlib import Path
import numpy as np
from lightgbm import LGBMRegressor,Booster

def main(run,seed,threads):
    data=np.load(run/'tree-inputs.npz')
    model=LGBMRegressor(objective='regression_l1',num_leaves=15,n_estimators=200,random_state=seed,n_jobs=threads,verbosity=-1,deterministic=True,force_col_wise=True).fit(data['x'],data['y'])
    model.booster_.save_model(str(run/'lightgbm.txt'));loaded=Booster(model_file=str(run/'lightgbm.txt'))
    error=float(np.abs(model.booster_.predict(data['x'][:100],num_threads=threads)-loaded.predict(data['x'][:100],num_threads=threads)).max())
    assert error<1e-10
    np.save(run/'tree-predictions.npy',np.maximum(0,loaded.predict(data['evaluation'],num_threads=threads)))
    (run/'tree-reload.json').write_text(json.dumps({'max_error':error,'threads':threads,'seed':seed}))
if __name__=='__main__':main(Path(sys.argv[1]),int(sys.argv[2]),int(sys.argv[3]))

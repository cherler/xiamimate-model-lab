"""Recompute saved replay metrics and audit the validation-only selection."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from common import ROOT,forecasts_metrics
from verify import verify_run,verify_ranking
from engine import fingerprint
from protocol import validate_boundaries


def verify_hpo(run):
    r=verify_run(run);search=r['search'];selection=search['selection'];protocol=search['protocol']
    validate_boundaries(protocol['config'],protocol['base'])
    assert selection['protocol_sha256']==fingerprint(protocol)
    completed=[t for t in search['trials'] if t['state']=='COMPLETE'];chosen=next(t for t in completed if t['number']==selection['trial'])
    assert selection['params']==chosen['params'] and selection['value']==chosen['value']
    assert chosen['value']==(min if selection['direction']=='minimize' else max)(t['value'] for t in completed)
    if r['model']!='tft':
        verify_ranking(run)
        for model,metrics in r['aggregate'].items():
            for key,value in metrics.items():np.testing.assert_allclose(value,np.mean([w['models'][model][key] for w in r['windows']]))
    else:
        rows=json.loads((run/'predictions.json').read_text());y=np.array([row['actual'] for row in rows]);assert len(rows)==r['rows']==504
        for model,metrics in r['aggregate'].items():
            for key,value in forecasts_metrics(y,[row[model] for row in rows]).items():np.testing.assert_allclose(value,metrics[key])
        for w in r['windows']:
            subset=[row for row in rows if row['origin']==w['origin']]
            for model,metrics in w['models'].items():
                for key,value in forecasts_metrics([row['actual'] for row in subset],[row[model] for row in subset]).items():np.testing.assert_allclose(value,metrics[key])
        q=np.array([[row['tuned_q10'],row['tft_tuned'],row['tuned_q90']] for row in rows]);assert np.all(np.diff(q,axis=1)>=0) and np.all(q>=0)
        np.testing.assert_allclose(np.mean((q[:,0]<=y)&(y<=q[:,2])),r['interval']['coverage']);np.testing.assert_allclose(np.mean(q[:,2]-q[:,0]),r['interval']['mean_width'])
        for idx,level in enumerate([.1,.5,.9]):
            delta=y-q[:,idx];np.testing.assert_allclose(np.maximum(level*delta,(level-1)*delta).mean(),r['interval']['pinball'][str(level)])
        assert r['decoder_target_invariance_max_error']<1e-5
    return r

if __name__=='__main__':
    for kind in sys.argv[1:] or ['lightgbm','lightgcn','tft']:
        p=json.loads((ROOT/f'artifacts/advanced-hpo-{kind}.json').read_text());run=ROOT/'artifacts/advanced-runs'/p['run_id'];verify_hpo(run);print('Verified',run.name)

"""Explain already published rows using frozen models. No fitting or partition access."""
from pathlib import Path
import hashlib
import json
import joblib
import numpy as np
from services.classification.run import predict

ROOT = Path(__file__).resolve().parents[2]
RUN = 'spambase-20261013T233632651140Z'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def decompose(bundle, x):
    linear = bundle['models']['logistic']
    tree = bundle['models']['lightgbm']
    z = linear[:-1].transform(x)
    linear_parts = z * linear[-1].coef_[0]
    linear_base = float(linear[-1].intercept_[0])
    tree_x = tree[:-1].transform(x)
    tree_parts = tree[-1].booster_.predict(tree_x, pred_contrib=True)
    tree_margin = tree[-1].booster_.predict(tree_x, raw_score=True)
    np.testing.assert_allclose(linear_base + linear_parts.sum(axis=1), linear.decision_function(x), atol=1e-10)
    np.testing.assert_allclose(tree_parts.sum(axis=1), tree_margin, atol=1e-9)
    return {'logistic': (np.full(len(x), linear_base), linear_parts, linear.decision_function(x)),
            'lightgbm': (tree_parts[:, -1], tree_parts[:, :-1], tree_margin)}

def export():
    parent_root = ROOT / 'apps/web/classification-results'
    m = json.loads((parent_root/'manifest.json').read_text())
    raw = (parent_root/m['path']).read_bytes()
    if sha(raw) != m['sha256'] or m['run_id'] != RUN:
        raise ValueError('Published parent changed')
    parent = json.loads(raw); report = parent['report']
    model_path = ROOT / 'artifacts/classification-runs' / RUN / 'models.joblib'
    if sha(model_path.read_bytes()) != report['model_sha256']:
        raise ValueError('Frozen model changed')
    bundle = joblib.load(model_path)
    if bundle['features'] != report['features'] or bundle['protocol'] != report['protocol']:
        raise ValueError('Frozen input schema changed')
    calibrators = {m: {'slope': float(c.coef_[0, 0]), 'intercept': float(c.intercept_[0]), 'clip': 1e-6}
                   for m,c in bundle['calibrators'].items()}
    result = {'schema': 'spambase-explanation-v1', 'run_id': RUN, 'parent_sha256': m['sha256'],
              'model_sha256': report['model_sha256'], 'exporter_sha256': sha(Path(__file__).read_bytes()),
              'features': report['features'], 'calibrators': calibrators, 'rows': {},
              'methods': {'lightgbm': 'native TreeSHAP pred_contrib, raw margin, tree-path-dependent',
                          'logistic': 'standardized log1p input multiplied by coefficient; intercept baseline, not SHAP'},
              'scope': 'Explanation of already published validation/test rows; no retraining, new labels or new test evaluation.',
              'notice': 'Spambase, Hopkins et al. (1999), UCI, DOI 10.24432/C53G6X, CC BY 4.0. Derived local model explanations; not causal attribution.'}
    errors=[]
    for split,rows in parent['rows'].items():
        x=np.array([r['features'] for r in rows]); raw_scores, calibrated=predict(bundle,{'x':x})
        for model in ['rules','logistic','lightgbm']:
            np.testing.assert_allclose(raw_scores[model],[r['raw_scores'][model] for r in rows],atol=1e-10,rtol=1e-10)
            np.testing.assert_allclose(calibrated[model],[r['scores'][model] for r in rows],atol=1e-10,rtol=1e-10)
        parts=decompose(bundle,x); result['rows'][split]={}
        for i,r in enumerate(rows):
            result['rows'][split][r['id']]={}
            for model,(base,contrib,margin) in parts.items():
                errors.append(abs(float(base[i]+contrib[i].sum()-margin[i])))
                result['rows'][split][r['id']][model]={'base':float(base[i]),'contributions':contrib[i].tolist(),'margin':float(margin[i])}
    result['max_additivity_error']=max(errors)
    data=json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    digest=sha(data);path=f'{digest[:16]}/case.json';out=ROOT/'apps/web/classification-explanations'
    (out/path).parent.mkdir(parents=True,exist_ok=True);(out/path).write_bytes(data)
    manifest={'schema':result['schema'],'run_id':RUN,'parent_sha256':m['sha256'],'path':path,'sha256':digest}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    audit={**manifest,'model_sha256':result['model_sha256'],'exporter_sha256':result['exporter_sha256'],
           'rows':{s:len(rows) for s,rows in parent['rows'].items()},'max_additivity_error':result['max_additivity_error'],
           'scope':result['scope'],'methods':result['methods']}
    (ROOT/'docs/evaluation/classification-explanations-v1.json').write_text(json.dumps(audit,indent=2)+'\n')
    print(json.dumps(audit,ensure_ascii=False))

if __name__=='__main__':
    export()

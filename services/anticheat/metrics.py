"""Frozen threshold and device-cluster summaries; scores are not guilt probabilities."""
import numpy as np
from sklearn.metrics import average_precision_score,roc_auc_score

def threshold(normal_scores,target=.01):
    s=np.sort(np.asarray(normal_scores,dtype=float))
    if not len(s) or not np.isfinite(s).all():raise ValueError('No valid normal calibration scores')
    # Strictly greater than order statistic, so ties cannot inflate calibration alerts.
    allowed=int(np.floor(len(s)*target))
    return float(np.nextafter(s[len(s)-allowed-1],np.inf))

def counts(y,score,cut):
    y=np.asarray(y,dtype=bool);alert=np.asarray(score)>=cut
    tp=int((y&alert).sum());fp=int((~y&alert).sum());n0=int((~y).sum());n1=int(y.sum())
    return {'n':len(y),'positive':n1,'negative':n0,'tp':tp,'fp':fp,'fn':n1-tp,'tn':n0-fp,'recall':tp/n1 if n1 else None,'fpr':fp/n0 if n0 else None,'precision':tp/(tp+fp) if tp+fp else None,'alerts':tp+fp}

def summary(y,score,cut,groups):
    r=counts(y,score,cut);r['ap']=float(average_precision_score(y,score)) if 0<sum(y)<len(y) else None
    r['auc']=float(roc_auc_score(y,score)) if 0<sum(y)<len(y) else None
    keys=np.unique(groups);r['devices']=len(keys);rng=np.random.default_rng(2810);samples={'recall':[],'fpr':[]}
    # Resample devices, retaining all of a selected device's windows.
    for _ in range(300):
        ids=np.concatenate([np.flatnonzero(groups==g) for g in rng.choice(keys,len(keys),replace=True)])
        v=counts(y[ids],score[ids],cut)
        for k in samples:
            if v[k] is not None:samples[k].append(v[k])
    r['intervals']={k:np.quantile(v,[.025,.975]).tolist() if v else None for k,v in samples.items()}
    return r

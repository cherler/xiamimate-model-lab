"""Independent defensive experiment. Models and decisions freeze before held-out scoring."""
import os
for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ.setdefault(k,'1')
import argparse,hashlib,json,time,platform
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
import joblib
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from lightgbm import LGBMClassifier
from .features import features,NAMES
from .metrics import threshold,counts,summary
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path(__file__).parent
P=json.loads((SOURCE/'protocol.json').read_text()) if (SOURCE/'protocol.json').exists() else {}
STORE=ROOT/'artifacts/anticheat-runs'/P.get('id','pending')
MODEL_NAMES={'rule':'最大转动规则','linear':'逻辑回归','lightgbm':'LightGBM','temporal_cnn':'轨迹 CNN','lightgbm_exposure':'LightGBM · 加入 GAN 样本'}
def sha(x):return hashlib.sha256(x).hexdigest()
def write(path,x):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(x,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
def now():return datetime.now(timezone.utc).isoformat()
def load_data():return dict(np.load(ROOT/'data/anticheat/prepared.npz',allow_pickle=False))
def splits(groups):
    unique=np.unique(groups);np.random.default_rng(P['seed']).shuffle(unique);n=len(unique);a=int(n*.6);b=int(n*.8)
    return {k:np.flatnonzero(np.isin(groups,g)) for k,g in [('train',unique[:a]),('calibration',unique[a:b]),('test',unique[b:])]}
def weights(ids,groups):
    _,rev,c=np.unique(groups[ids],return_inverse=True,return_counts=True);w=1/c[rev];return w/w.mean()
def cnn_score(bundle,w):
    import torch
    from .network import TrajectoryCNN
    if 'instance' not in bundle:
        m=TrajectoryCNN();m.load_state_dict(bundle['state']);m.eval();bundle['instance']=m
    x=(w-bundle['mean'])/bundle['scale']
    with torch.inference_mode():return torch.sigmoid(bundle['instance'](torch.tensor(x,dtype=torch.float32))).numpy()
def predict(name,bundle,w,x=None):
    if name=='temporal_cnn':return cnn_score(bundle,w)
    if x is None:x=features(w)
    if name=='rule':return x[:,2]
    if name.startswith('lightgbm'):return bundle.booster_.predict(x,num_threads=1)
    return bundle.predict_proba(x)[:,1]
def train():
    import torch
    from .network import TrajectoryCNN
    if STORE.exists():raise ValueError('Run already exists: use verify; new experiments need a new protocol')
    d=load_data();w=d['windows'];x=features(w);y=(d['kinds']!='none').astype(int);s=splits(d['groups']);known=np.isin(d['kinds'],['none','ease_light','ease_strong'])
    tr=s['train'][known[s['train']]];va=s['calibration'][known[s['calibration']]];te=s['test']
    if min(len(np.unique(d['groups'][q])) for q in s.values())<3:raise ValueError('Too few device groups')
    STORE.mkdir(parents=True)
    write(STORE/'protocol.json',P);write(STORE/'split.json',{k:v.tolist() for k,v in s.items()})
    hashes={p.name:sha(p.read_bytes()) for p in SOURCE.glob('*.py')};write(STORE/'source-hashes.json',hashes)
    for p in SOURCE.glob('*.py'):(STORE/p.name).write_bytes(p.read_bytes())
    write(STORE/'source.json',{'prepared_sha256':sha((ROOT/'data/anticheat/prepared.npz').read_bytes()),'archive_md5':P['archive_md5']})
    fitted={};timings={};scores={};cuts={};calibration={}
    for name in MODEL_NAMES:
        start=time.perf_counter();ids=tr
        if name=='lightgbm_exposure':ids=s['train'][np.isin(d['kinds'][s['train']],['none','ease_light','ease_strong','gan_group0'])]
        if name=='rule':model=None
        elif name=='linear':
            model=make_pipeline(StandardScaler(),LogisticRegression(C=1,max_iter=1000,random_state=P['seed']))
            model.fit(x[ids],y[ids],logisticregression__sample_weight=weights(ids,d['groups']))
        elif name.startswith('lightgbm'):
            model=LGBMClassifier(**P['lightgbm'],random_state=P['seed']);model.fit(x[ids],y[ids],sample_weight=weights(ids,d['groups']))
        else:
            torch.set_num_threads(1);torch.manual_seed(P['seed']);rng=np.random.default_rng(P['seed'])
            mean=w[tr].mean(axis=(0,1));scale=np.maximum(w[tr].std(axis=(0,1)),1e-5)
            tw=torch.tensor((w[tr]-mean)/scale);ty=torch.tensor(y[tr],dtype=torch.float32);sw=torch.tensor(weights(tr,d['groups']),dtype=torch.float32)
            net=TrajectoryCNN();opt=torch.optim.AdamW(net.parameters(),lr=.002,weight_decay=.001)
            # Fixed epochs; no test or calibration selection of architecture/epoch.
            for epoch in range(P['cnn_epochs']):
                net.train()
                for batch in np.array_split(rng.permutation(len(tr)),max(1,int(np.ceil(len(tr)/256)))):
                    opt.zero_grad();loss=(torch.nn.functional.binary_cross_entropy_with_logits(net(tw[batch]),ty[batch],reduction='none')*sw[batch]).mean();loss.backward();opt.step()
            net.eval();model={'state':{k:v.detach().cpu() for k,v in net.state_dict().items()},'mean':mean,'scale':scale}
        timings[name]=time.perf_counter()-start;fitted[name]=model
        v=predict(name,model,w[va],x[va]);cuts[name]=threshold(v[y[va]==0],P['calibration_fpr'])
        calibration[name]=counts(y[va],v,cuts[name]);scores[name]=predict(name,model,w[te],x[te])
        if name=='temporal_cnn':model.pop('instance',None)
        print(name,'trained',round(timings[name],2),'seconds',flush=True)
    joblib.dump(fitted,STORE/'models.joblib');np.savez_compressed(STORE/'scores.npz',**scores)
    frozen={'at':now(),'thresholds':cuts,'calibration':calibration,'train_seconds':timings,'models_sha256':sha((STORE/'models.joblib').read_bytes()),'scores_sha256':sha((STORE/'scores.npz').read_bytes())}
    write(STORE/'frozen.json',frozen)
    write(STORE/'test-access.json',{'at':now(),'purpose':'First scoring after models, predictions and thresholds were frozen. Public benchmark metadata audited earlier.','frozen_sha256':sha((STORE/'frozen.json').read_bytes()),'status':'consumed'})
    report=report_results(d,s,scores,fitted,frozen)
    write(STORE/'report.json',report);export(report)
    print(json.dumps({'split':report['split'],'models':{k:v['known'] for k,v in report['models'].items()}},ensure_ascii=False),flush=True)

def bench(name,m,w):
    from .features import features
    import torch
    torch.set_num_threads(1)
    one=w[:1]
    for _ in range(20):predict(name,m,one)
    elapsed=[]
    for _ in range(200):
        start=time.perf_counter_ns();predict(name,m,one);elapsed.append((time.perf_counter_ns()-start)/1e6)
    many=w[:64];bt=[]
    for _ in range(50):
        start=time.perf_counter_ns();predict(name,m,many);bt.append((time.perf_counter_ns()-start)/1e6)
    return {'p50_ms':float(np.median(elapsed)),'p95_ms':float(np.quantile(elapsed,.95)),'p99_ms':float(np.quantile(elapsed,.99)),'batch':len(many),'batch_p50_ms':float(np.median(bt)),'runs':200,'batch_runs':50,'warmup':20}

def report_results(d,s,scores,fitted,frozen):
    test=s['test'];w=d['windows'][test];x=features(w);kinds=d['kinds'][test];y=(kinds!='none').astype(int);groups=d['groups'][test];known=np.isin(kinds,['none','ease_light','ease_strong'])
    r={'schema':1,'run_id':P['id'],'protocol':P,'source':P['source'],'at':now(),'feature_names':NAMES,'split':{},'models':{},'samples':[],'audit':{},'performance':{'platform':platform.platform(),'cpu':platform.processor() or platform.machine(),'threads':1,'scope':'模型已加载，串行 CPU；完整窗口到分数，含特征／归一化，不含窗口积累、日志解析、网络、排队与告警处置。'}}
    audit=json.loads((ROOT/'data/anticheat/audit.json').read_text());r['audit']={k:v for k,v in audit.items() if k!='episodes'};r['audit']['episodes']=len(audit['episodes']);r['audit']['prepared_sha256']=sha((ROOT/'data/anticheat/prepared.npz').read_bytes())
    for part,ids in s.items():r['split'][part]={'devices':len(np.unique(d['groups'][ids])),'windows':len(ids),'conditions':{k:int((d['kinds'][ids]==k).sum()) for k in np.unique(d['kinds'])}}
    for name,score in scores.items():
        cut=frozen['thresholds'][name];v={'name':MODEL_NAMES[name],'threshold':cut,'calibration':frozen['calibration'][name],'train_seconds':frozen['train_seconds'][name],'known':summary(y[known],score[known],cut,groups[known]),'all':summary(y,score,cut,groups),'types':{},'performance':bench(name,fitted[name],w)}
        for k in ['ease_light','ease_strong','gan_group0','gan_group1']:
            mask=(kinds==k)|(kinds=='none');v['types'][k]=summary(y[mask],score[mask],cut,groups[mask])
        r['models'][name]=v
    # Predetermined deterministic exemplar rule: first record in each outcome bin for each model, plus all conditions.
    chosen=set()
    for name,score in scores.items():
        alert=score>=frozen['thresholds'][name]
        for yy in [0,1]:
            for aa in [0,1]:
                ids=np.flatnonzero((y==yy)&(alert==aa));chosen.update(ids[:1].tolist())
        for k in np.unique(kinds):chosen.update(np.flatnonzero(kinds==k)[:1].tolist())
    for i in sorted(chosen):
        contributions=fitted['lightgbm'].booster_.predict(x[i:i+1],pred_contrib=True,num_threads=1)[0]
        raw=fitted['lightgbm'].booster_.predict(x[i:i+1],raw_score=True,num_threads=1)[0]
        if not np.isclose(contributions.sum(),raw,atol=1e-6):raise ValueError('Contribution sum mismatch')
        r['samples'].append({'id':f'window-{int(test[i])}','device':f'device-{sorted(np.unique(groups)).index(groups[i])+1:02}','episode':d['episodes'][test[i]],'tick':int(d['ticks'][test[i]]),'kind':str(kinds[i]),'trajectory':w[i].tolist(),'features':x[i].tolist(),'scores':{k:float(v[i]) for k,v in scores.items()},'lightgbm_contributions':contributions[:-1].tolist(),'lightgbm_base':float(contributions[-1]),'lightgbm_logit':float(raw)})
    # Observable data-quality sensitivity, not an adaptive attacker or adversarial robustness certification.
    r['quality_stress']={}
    for condition,z in [('half_rate_hold',np.repeat(w[:,::2],2,axis=1)[:,:35]),('last_five_missing',np.concatenate([w[:,:30],np.zeros_like(w[:,30:])],axis=1))]:
        pred=predict('lightgbm',fitted['lightgbm'],z)
        r['quality_stress'][condition]=summary(y,pred,frozen['thresholds']['lightgbm'],groups)
    return r

def export(r):
    body=(json.dumps(r,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();digest=sha(body);root=ROOT/'apps/web/anticheat-results';out=root/digest[:16];out.mkdir(parents=True,exist_ok=True);(out/'case.json').write_bytes(body)
    write(root/'manifest.json',{'schema':1,'run_id':P['id'],'path':digest[:16]+'/case.json','sha256':digest})

def verify():
    import torch
    torch.set_num_threads(1)
    if json.loads((STORE/'protocol.json').read_text())!=P:raise ValueError('Protocol changed')
    for name,digest in json.loads((STORE/'source-hashes.json').read_text()).items():
        if sha((SOURCE/name).read_bytes())!=digest:raise ValueError('Training source changed: '+name)
    d=load_data();s={k:np.array(v) for k,v in json.loads((STORE/'split.json').read_text()).items()};f=json.loads((STORE/'frozen.json').read_text());saved=dict(np.load(STORE/'scores.npz'));models=joblib.load(STORE/'models.joblib');report=json.loads((STORE/'report.json').read_text())
    if sha((ROOT/'data/anticheat/prepared.npz').read_bytes())!=report['audit']['prepared_sha256']:raise ValueError('Source changed')
    if sha((STORE/'models.joblib').read_bytes())!=f['models_sha256'] or sha((STORE/'scores.npz').read_bytes())!=f['scores_sha256']:raise ValueError('Frozen artifacts changed')
    groups=[set(d['groups'][v]) for v in s.values()]
    if any(groups[i]&groups[j] for i in range(3) for j in range(i)):raise ValueError('Device leakage')
    te=s['test'];w=d['windows'][te];x=features(w);y=(d['kinds'][te]!='none').astype(int)
    for name,m in models.items():
        pred=predict(name,m,w,x);np.testing.assert_allclose(pred,saved[name],rtol=1e-5,atol=1e-7)
        metric=summary(y,pred,f['thresholds'][name],d['groups'][te]);assert metric==report['models'][name]['all']
        for kind in report['models'][name]['types']:
            mask=np.isin(d['kinds'][te],['none',kind]);assert summary(y[mask],pred[mask],f['thresholds'][name],d['groups'][te][mask])==report['models'][name]['types'][kind]
    for sample in report['samples']:
        idx=int(sample['id'].split('-')[1]);np.testing.assert_allclose(d['windows'][idx],sample['trajectory']);np.testing.assert_allclose(features(d['windows'][idx:idx+1])[0],sample['features'])
        c=models['lightgbm'].booster_.predict(features(d['windows'][idx:idx+1]),pred_contrib=True,num_threads=1)[0];np.testing.assert_allclose(c,np.r_[sample['lightgbm_contributions'],sample['lightgbm_base']])
    export(report);print('Verified all frozen model scores, grouped statistics, explanations and hashes; no retraining.')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['train','verify']);args=parser.parse_args()
    train() if args.action=='train' else verify()

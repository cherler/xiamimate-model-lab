"""Audit the official archive; store de-identified derived arrays locally only."""
import hashlib,json,zipfile,collections
from pathlib import Path
import numpy as np
from .features import extract
ROOT=Path(__file__).resolve().parents[2]
RAW=ROOT/'data/anticheat/raw/data.zip'
def prepare():
    out=ROOT/'data/anticheat/prepared.npz'
    if out.exists():return
    h=hashlib.md5()
    with RAW.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    if h.hexdigest()!='5a1d93c6616c5fdac31547f00ed372e8':raise ValueError('Archive hash mismatch')
    arrays=[];meta=[];audit=[]
    with zipfile.ZipFile(RAW) as z:
        names=sorted(n for n in z.namelist() if n.endswith('.json') and any('/data_collection_'+str(i)+'/' in '/'+n for i in [1,2,3]))
        print('JSON files',len(names),flush=True)
        for idx,name in enumerate(names):
            d=json.loads(z.read(name));hardware=d.get('hwid')
            if hardware is None:raise ValueError('Hardware grouping missing')
            group=hashlib.sha256(('anticheat-v1:'+str(hardware)).encode()).hexdigest()[:16]
            episode=hashlib.sha256(name.encode()).hexdigest()[:16]
            kind=d.get('aimbot') or 'none'
            if kind not in ('none','ease_light','ease_strong','gan_group0','gan_group1'):raise ValueError('Unexpected condition '+str(kind))
            w,ticks=extract(d)
            # Only hashes and derived motion are retained; no raw hardware ID in exports.
            arrays.append(w);meta.extend((group,episode,kind,int(t)) for t in ticks)
            audit.append({'episode':episode,'group':group,'collection':next('collection_'+str(i) for i in [1,2,3] if 'data_collection_'+str(i) in name),'kind':kind,'frames':len(d['actions']),'windows':len(w)})
            if idx%100==0:print('Processed',idx,flush=True)
    m=np.array(meta)
    np.savez_compressed(out,windows=np.concatenate(arrays),groups=m[:,0],episodes=m[:,1],kinds=m[:,2],ticks=m[:,3].astype(int))
    report={'source':'https://zenodo.org/records/6345323','license':'CC BY 4.0','archive_md5':h.hexdigest(),'episodes':audit,'groups':len(set(m[:,0])),'windows':len(m),'conditions':dict(collections.Counter(m[:,2]))}
    (out.parent/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print({k:v for k,v in report.items() if k!='episodes'},flush=True)
if __name__=='__main__':prepare()

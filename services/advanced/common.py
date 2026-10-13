"""Isolated, explicitly developmental experiments; never alter earlier releases."""
from pathlib import Path
import hashlib
import json
import os
import platform
from importlib.metadata import version, PackageNotFoundError
import subprocess
from datetime import datetime, timezone
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).with_name('config.json')

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2)+'\n')

def load_data():
    path=ROOT/'data/processed/transactions.csv.gz'
    audit=json.loads((ROOT/'data/processed/audit.json').read_text())
    if sha(path)!=audit['processed_sha256']:
        raise ValueError('Processed public-data checksum mismatch')
    frame=pd.read_csv(path, dtype={'customer':'string','item':str,'invoice':str},parse_dates=['date'])
    return frame[frame.country=='United Kingdom'].copy(), {'name':'UCI Online Retail II','license':audit['license'],'citation':audit['citation'],'source':audit['source_page'],'processed_sha256':audit['processed_sha256']}

def new_run(kind, config):
    name=f"{kind}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}"
    path=ROOT/'artifacts/advanced-runs'/name
    path.mkdir(parents=True,exist_ok=False)
    write(path/'config.json',config)
    return path

def finish(run, report, kind):
    report.update(run_id=run.name,evidence='development_after_prior_feedback',environment={'python':platform.python_version(),'machine':platform.machine(),'threads':2},source_code_sha256={p.name:sha(p) for p in Path(__file__).parent.glob('*.py')},limitations=report.get('limitations',[])+['UCI windows have already informed previous development. This is not an independent confirmation test.','Offline public-data results do not prove conversion or revenue gains.'])
    report['environment']['packages']={}
    for name in ['numpy','pandas','scipy','scikit-learn','lightgbm','torch','pytorch-forecasting','lightning']:
        try: report['environment']['packages'][name]=version(name)
        except PackageNotFoundError: pass
    report['environment']['git_head']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    write(run/'report.json',report)
    write(run/'checksums.json',{str(p.relative_to(run)):sha(p) for p in sorted(run.rglob('*')) if p.is_file() and p.name!='checksums.json'})
    pointer=ROOT/f'artifacts/advanced-{kind}.json';tmp=pointer.with_suffix('.tmp')
    write(tmp,{'run_id':run.name,'report_sha256':sha(run/'report.json')});os.replace(tmp,pointer)

def rank_metrics(ranked,target):
    hits=np.array([x in target for x in ranked[:10]],dtype=float)
    ideal=sum(1/np.log2(i+2) for i in range(min(10,len(target))))
    return {'recall':float(hits.sum()/len(target)) if target else None,'ndcg':float((hits/np.log2(np.arange(len(hits))+2)).sum()/ideal) if ideal else 0.,'hit_rate':float(hits.sum()>0)}

def forecasts_metrics(y,p):
    y=np.asarray(y);p=np.asarray(p);den=y.sum()
    return {'wape':float(np.abs(y-p).sum()/den) if den else None,'mae':float(np.abs(y-p).mean()),'bias':float((p-y).sum()/den) if den else None}

def stable_users(users,n):
    return sorted(users,key=lambda u:hashlib.sha256(f'advanced-v1:{u}'.encode()).hexdigest())[:n]

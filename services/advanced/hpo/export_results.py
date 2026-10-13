"""Publish complete, verified offline AutoML histories and replay samples."""
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ROOT,sha,write
from verify_results import verify_hpo


def export():
    runs={};reports={}
    for kind in ['lightgbm','lightgcn','tft']:
        p=json.loads((ROOT/f'artifacts/advanced-hpo-{kind}.json').read_text());run=ROOT/'artifacts/advanced-runs'/p['run_id']
        if sha(run/'report.json')!=p['report_sha256']:raise ValueError('Replay pointer digest mismatch')
        runs[kind]=run;reports[kind]=verify_hpo(run)
    if reports['lightgbm']['parent_ranking']!=reports['lightgcn']['parent_ranking']:raise ValueError('Recommendation cohorts differ')
    version=hashlib.sha256(''.join(sha(run/'report.json') for run in runs.values()).encode()).hexdigest()[:16]
    dest=ROOT/'apps/web/tuning-results'/version;dest.mkdir(parents=True,exist_ok=True)
    manifest={'version':version,'evidence':'development_after_prior_feedback','resources':{},'runs':{k:v.name for k,v in runs.items()}}
    for kind,run in runs.items():
        samples=json.loads((run/'samples.json').read_text())
        if kind!='tft':
            for s in samples:
                shown=set(s['history'])|{i for row in s['models'].values() for i in row['ranked']}
                s['names']={k:v for k,v in s['names'].items() if k in shown};s.pop('features',None)
        for name,value in [(kind,reports[kind]),(kind+'-samples',samples)]:
            path=dest/f'{name}.json';write(path,value);manifest['resources'][name]={'path':f'{version}/{name}.json','sha256':sha(path)}
    temp=dest.parent/'manifest.tmp';write(temp,manifest);temp.replace(dest.parent/'manifest.json');print('Exported AutoML',version)
if __name__=='__main__':export()

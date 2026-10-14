"""Export checksum-bound experiment results, separate from frozen showcase releases."""
import hashlib
import json
from common import ROOT,sha,write
from verify import verify_ranking,verify_tft

def export():
    runs={};reports={}
    for kind in ['ranking','graph','tft']:
        pointer=json.loads((ROOT/f'artifacts/advanced-{kind}.json').read_text());run=ROOT/'artifacts/advanced-runs'/pointer['run_id']
        if sha(run/'report.json')!=pointer['report_sha256']:raise ValueError('Pointer digest mismatch')
        runs[kind]=run;reports[kind]=verify_tft(run) if kind=='tft' else verify_ranking(run)
    if reports['graph']['parent_ranking']!=runs['ranking'].name:raise ValueError('Graph/ranking cohort mismatch')
    explanations={}
    for kind in ['trees','graph','tft']:
        path=ROOT/f'artifacts/advanced-explanation-{kind}.json'
        if not path.exists():continue
        payload=json.loads(path.read_text())
        if payload['runs']!={k:p.name for k,p in runs.items()} or payload['reports']!={k:sha(p/'report.json') for k,p in runs.items()}:
            raise ValueError('Explanation/source version mismatch')
        explanations[f'explanation-{kind}']=payload
    version=hashlib.sha256((''.join(sha(p/'report.json') for p in runs.values())+json.dumps(explanations,sort_keys=True)).encode()).hexdigest()[:16]
    dest=ROOT/'apps/web/advanced-results'/version;dest.mkdir(parents=True,exist_ok=True)
    samples=json.loads((runs['graph']/'samples.json').read_text())
    for sample in samples:
        shown=set(sample['history'])|set(sample['target'])|{i for r in sample['models'].values() for i in r['ranked']}
        sample['names']={k:v for k,v in sample['names'].items() if k in shown}
        sample['features']={k:v for k,v in sample['features'].items() if k in shown}
    payloads={**explanations,**{kind:report for kind,report in reports.items()},'recommendation-samples':samples,'forecast-samples':json.loads((runs['tft']/'samples.json').read_text())}
    manifest={'version':version,'evidence':'development_after_prior_feedback','runs':{k:p.name for k,p in runs.items()},'resources':{}}
    for name,data in payloads.items():
        path=dest/f'{name}.json';write(path,data);manifest['resources'][name]={'path':f'{version}/{name}.json','sha256':sha(path)}
    path=dest.parent/'manifest.json';temp=path.with_suffix('.tmp');write(temp,manifest);temp.replace(path)
    print('Exported',version,len(samples),'recommendation examples')
if __name__=='__main__':export()

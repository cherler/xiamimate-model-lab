"""Offline search -> immutable selection -> one saved replay. No training from HTTP."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2');os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import argparse
import fcntl
import json
import re
import time
# Initialize Torch before LightGBM's OpenMP library in graph workers.
if len(sys.argv)>1 and sys.argv[1]=='lightgcn':
    import torch
from common import ROOT,CONFIG,sha,new_run,finish,write
from engine import StudyRunner
from protocol import validate_boundaries


def main():
    parser=argparse.ArgumentParser();parser.add_argument('model',choices=['lightgbm','lightgcn','tft']);parser.add_argument('--name',default='v1');parser.add_argument('--trials',type=int);parser.add_argument('--seconds',type=int);parser.add_argument('--phase',choices=['search','evaluate','all'],default='all');args=parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',args.name):raise ValueError('Invalid study name')
    if (args.trials is not None and args.trials<1) or (args.seconds is not None and args.seconds<1):raise ValueError('Budgets must be positive')
    config=json.loads(Path(__file__).with_name('config.json').read_text());base=json.loads(CONFIG.read_text());path=ROOT/'artifacts/advanced-studies'/f'{args.model}-{args.name}';path.mkdir(parents=True,exist_ok=True)
    validate_boundaries(config,base)
    with (path/'worker.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        parent={}
        for kind in ['ranking','graph','tft']:
            pointer=json.loads((ROOT/f'artifacts/advanced-{kind}.json').read_text());directory=ROOT/'artifacts/advanced-runs'/pointer['run_id']
            if sha(directory/'report.json')!=pointer['report_sha256']:raise ValueError('Parent hash mismatch')
            parent[kind]=directory
        source_files=['engine.py','run.py','protocol.py','forecasting.py' if args.model=='tft' else 'recommendation.py']
        spec={'model':args.model,'config':config,'base':base,'parents':{k:{'run':v.name,'sha256':sha(v/'report.json')} for k,v in parent.items()},'source_code':{n:sha(Path(__file__).with_name(n)) for n in source_files},'objective':'August median MAE' if args.model=='tft' else 'August full-target NDCG@10','selection_boundary':'training labels before August; validation labels before September; freeze before September-November replay','source_data':sha(ROOT/'data/processed/transactions.csv.gz'),'dependency_lock':sha(Path(__file__).resolve().parents[1]/'uv.lock')}
        runner=StudyRunner(path,spec,'minimize' if args.model=='tft' else 'maximize',config['seed'])
        (path/'source').mkdir(exist_ok=True)
        for name in source_files:(path/'source'/name).write_bytes(Path(__file__).with_name(name).read_bytes())
        if (path/'replay.json').exists():
            print('Saved replay already exists:',json.loads((path/'replay.json').read_text()));return
        if args.model=='tft':
            from forecasting import ForecastAdapter
            adapter=ForecastAdapter(path,config,base,parent)
        else:
            from recommendation import RecommendationAdapter
            adapter=RecommendationAdapter(args.model,path,config,base,parent)
        budget=config['budgets'][args.model];start=time.perf_counter()
        if args.phase in ['search','all'] and not (path/'selection.json').exists():runner.optimize(adapter.objective,args.trials or budget['trials'],args.seconds or budget['seconds'],adapter.initial())
        if args.phase=='search':return
        if args.phase=='evaluate' and not any(t.state.name=='COMPLETE' for t in runner.study.trials):raise ValueError('No completed search')
        selection=runner.freeze();snapshot=runner.snapshot();run=new_run('hpo-'+args.model,spec);write(run/'search.json',snapshot)
        report=adapter.evaluate_selected(selection,run);report.update(model=args.model,study=path.name,search=snapshot,search_and_replay_seconds=time.perf_counter()-start)
        finish(run,report,'hpo-'+args.model);write(path/'replay.json',{'run_id':run.name,'report_sha256':sha(run/'report.json')});print(run,flush=True)
if __name__=='__main__':main()

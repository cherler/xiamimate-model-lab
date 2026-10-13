"""Bounded cross-model/feature grid, validation freeze, then selected-model replay."""
import argparse
from datetime import datetime,timezone
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ROOT,CONFIG,new_run,sha,write,finish
from automl.policy import select

HERE=Path(__file__).resolve().parent


def specification():
    config=json.loads((HERE/'config.json').read_text());parents={};fixed={}
    from datetime import date, timedelta
    origins=[date.fromisoformat(o) for o in config['validation_origins']]
    if len(origins)!=len(set(origins)) or any(o<date(2011,8,1) or o+timedelta(days=7)>date(2011,9,1) for o in origins):raise ValueError('Validation labels must stay within August')
    if any((b-a).days<7 for a,b in zip(sorted(origins),sorted(origins)[1:])):raise ValueError('Overlapping validation origins')
    for kind in ['ranking','hpo-lightgbm','hpo-lightgcn','hpo-tft']:
        p=json.loads((ROOT/f'artifacts/advanced-{kind}.json').read_text());d=ROOT/'artifacts/advanced-runs'/p['run_id']
        checks=json.loads((d/'checksums.json').read_text())
        if sha(d/'report.json')!=p['report_sha256'] or any(sha(d/name)!=digest for name,digest in checks.items()):raise ValueError('Parent checksum mismatch')
        parents[kind]={'run':d.name,'sha256':sha(d/'report.json')}
        if kind.startswith('hpo-'):fixed[kind[4:]]=json.loads((d/'report.json').read_text())['search']['selection']
    files=[*HERE.glob('*.py'),*HERE.parent.glob('*.py'),*(HERE.parent/'hpo').glob('*.py')]
    return dict(config=config,base=json.loads(CONFIG.read_text()),parents=parents,fixed_parameters=fixed,source_data=sha(ROOT/'data/processed/transactions.csv.gz'),dependency_lock=sha(HERE.parent/'uv.lock'),sources={str(p.relative_to(HERE.parent)):sha(p) for p in files})


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--resume');args=parser.parse_args();spec=specification()
    if args.resume:
        if not re.fullmatch(r'automl-[0-9TZ]+',args.resume):raise ValueError('Invalid run id')
        run=ROOT/'artifacts/advanced-runs'/args.resume
        if json.loads((run/'config.json').read_text())!=spec:raise ValueError('Sources/configuration changed; start a new run')
    else:run=new_run('automl',spec)
    print('AutoML run',run.name,flush=True)
    # Lock lives outside the immutable checksummed run; retry never rewrites an old report.
    lockpath=ROOT/'artifacts/advanced-studies'/f'{run.name}.lock';lockpath.parent.mkdir(exist_ok=True,parents=True)
    with lockpath.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if (run/'report.json').exists():print('Already complete',run.name);return
        for name in spec['sources']:
            p=run/'source'/name;p.parent.mkdir(exist_ok=True,parents=True);p.write_bytes((HERE.parent/name).read_bytes())
        def worker(script,phase,complete):
            if (run/complete).exists():return
            print(script,phase,flush=True)
            with (run/f'{script}-{phase}.log').open('a') as log:
                subprocess.run([sys.executable,str(HERE/f'{script}.py'),str(run),phase],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=spec['config']['worker_timeout_seconds'],env={**os.environ,'OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2'})
        start=time.perf_counter()
        worker('prepare','validation','preparation-validation.json')
        worker('recommendation','validation-trees','recommendation-trees-candidates.json')
        worker('recommendation','validation-graph','recommendation-graph-candidates.json')
        worker('forecasting','validation','forecast-trees-validation.json')
        worker('tft','validation','forecast-tft-validation.json')
        rec=json.loads((run/'recommendation-trees-candidates.json').read_text())+json.loads((run/'recommendation-graph-candidates.json').read_text());rec.sort(key=lambda r:spec['config']['recommendation_candidates'].index(r['id']));write(run/'recommendation-candidates.json',rec);forecast=json.loads((run/'forecast-trees-validation.json').read_text())+[json.loads((run/'forecast-tft-validation.json').read_text())]
        for task,rows in [('recommendation',rec),('forecast',forecast)]:
            if {r['id'] for r in rows}!=set(spec['config'][task+'_candidates']):raise ValueError('Incomplete candidate grid; no selection published')
        from automl.verify import verify_validation
        verify_validation(run,rec,forecast)
        selections={task:select(rows,direction,spec['config']['relative_tolerance']) for task,rows,direction in [('recommendation',rec,'maximize'),('forecast',forecast,'minimize')]}
        evidence={name:sha(run/name) for name in ['recommendation-candidates.json','forecast-trees-validation.json','forecast-tft-validation.json']}
        if (run/'selection.json').exists():
            saved=json.loads((run/'selection.json').read_text())
            if any(saved[k]!=v for k,v in selections.items()) or saved['validation_sha256']!=evidence:raise ValueError('Frozen selection differs')
        else:write(run/'selection.json',{**selections,'validation_sha256':evidence,'frozen_at':datetime.now(timezone.utc).isoformat()})
        print('Frozen choices',selections,flush=True)
        worker('prepare','replay','preparation-replay.json')
        worker('recommendation','replay-trees','recommendation-trees-replay.json')
        worker('recommendation','replay-graph','recommendation-graph-replay.json')
        write(run/'recommendation-replay.json',{**json.loads((run/'recommendation-trees-replay.json').read_text()),**json.loads((run/'recommendation-graph-replay.json').read_text())})
        worker('forecasting','replay','forecast-trees-replay.json')
        worker('tft','replay','forecast-tft-replay.json')
        replay_forecast=json.loads((run/'forecast-trees-replay.json').read_text())
        if (run/'forecast-tft-replay.json').exists():replay_forecast.append(json.loads((run/'forecast-tft-replay.json').read_text()))
        report=dict(config=spec['config'],parents=spec['parents'],selection=json.loads((run/'selection.json').read_text()),candidates={'recommendation':rec,'forecast':forecast},replay={'recommendation':json.loads((run/'recommendation-replay.json').read_text()),'forecast':{r['id']:r for r in replay_forecast}},preparation=json.loads((run/'preparation-validation.json').read_text()),duration_seconds=time.perf_counter()-start,limitations=['Small exhaustive family/feature grid with previously tuned parameters, not global optimization.','Prior HPO and prior UCI outcomes informed this development; no independent or nested validation claim.','Cost excludes shared preparation and past HPO; one local sequential CPU run is not a robust latency benchmark.','Only validation-selected accuracy/cost choices are replayed; replay results never reselect winners.','Feature ablations keep tree hyperparameters fixed; differences describe this model/cohort, not causal feature effects.'])
        from automl.verify import verify_replay
        verify_replay(run,report)
        finish(run,report,'automl');print('Complete',run.name,flush=True)
if __name__=='__main__':main()

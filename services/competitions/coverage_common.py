"""Immutable research-run storage shared by coverage and interval experiments."""
from datetime import datetime, timezone
import json
import shutil
import subprocess
from pathlib import Path
from .m5_data import ROOT, digest, write

RUNS=ROOT/'artifacts/competition-runs'
PROTOCOL=Path(__file__).with_name('coverage-protocol.json')

def checked(run):
    checks=json.loads((run/'checksums.json').read_text())
    for name,sha in checks.items():
        path=(run/name).resolve()
        if not path.is_relative_to(run.resolve()) or digest(path)!=sha:raise ValueError(f'evidence changed: {name}')
    return json.loads((run/'report.json').read_text())

def start(kind):
    cfg=json.loads(PROTOCOL.read_text());base=RUNS/cfg[kind]['base_run'];base_report=checked(base)
    run=RUNS/(kind+'-coverage-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));run.mkdir()
    write(run/'protocol.json',cfg)
    source=run/'source';source.mkdir()
    for p in Path(__file__).parent.glob('*.py'):shutil.copyfile(p,source/p.name)
    ledger=RUNS/'m5-access-CA_1-1913.json'
    write(run/'provenance.json',{'base_run':base.name,'base_report_sha256':digest(base/'report.json'),
        'source':{p.name:digest(p) for p in source.iterdir()},'ledger_sha256':digest(ledger),
        'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'created_at':datetime.now(timezone.utc).isoformat()})
    return run,cfg,base,base_report

def seal(run,report):
    write(run/'report.json',report)
    write(run/'checksums.json',{str(p.relative_to(run)):digest(p) for p in run.rglob('*') if p.is_file() and p.name!='checksums.json'})

def publish_pointer(kind,run):
    checked(run)
    pointer=ROOT/f'artifacts/competition-{kind}-coverage.json';tmp=pointer.with_suffix('.tmp')
    write(tmp,{'run_id':run.name,'report_sha256':digest(run/'report.json')});tmp.replace(pointer)

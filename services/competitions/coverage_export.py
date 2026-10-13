"""Verify optional coverage studies against their original case before UI export."""
import json
from .coverage_common import RUNS
from .m5_data import ROOT,digest


def read_coverage(kind,base):
    pointer=ROOT/f'artifacts/competition-{kind}-coverage.json'
    if not pointer.exists():return None,'no-coverage'
    p=json.loads(pointer.read_text());folder=RUNS/p['run_id']
    if not folder.resolve().is_relative_to(RUNS.resolve()) or digest(folder/'report.json')!=p['report_sha256']:raise ValueError('invalid coverage pointer')
    provenance=json.loads((folder/'provenance.json').read_text())
    if provenance['base_run']!=base.name or provenance['base_report_sha256']!=digest(base/'report.json'):raise ValueError('coverage base mismatch')
    if provenance['ledger_sha256']!=digest(RUNS/'m5-access-CA_1-1913.json'):raise ValueError('reserved access ledger changed')
    if kind=='dressipi':
        from .coverage_recommend import verify
        report=verify(folder,base);data={'report':report,'samples':json.loads((folder/'samples.json').read_text())}
    else:
        from .coverage_forecast import verify
        report=verify(folder);data={'report':report}
    if report['base_run_id']!=base.name or report['status']!='complete_development' or report['public_export_allowed'] is not False:raise ValueError('invalid coverage status')
    return data,p['report_sha256']

"""Verify saved development rankings before exporting a local-only Dressipi case."""
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.competitions.m5_data import ROOT,digest,write
from services.competitions.dressipi import ranking_metrics


def verify_run(run):
    checks=json.loads((run/'checksums.json').read_text())
    for name,sha in checks.items():
        if Path(name).name!=name or digest(run/name)!=sha:raise ValueError('run checksum mismatch')
    report=json.loads((run/'report.json').read_text());rows=json.loads((run/'predictions.json').read_text())
    if report['status']!='complete_development' or report['public_export_allowed'] is not False:raise ValueError('unpublishable report state')
    targets={r['session']:r['target'] for r in rows}
    if len(targets)!=len(rows) or len(rows)!=report['cohort']['validation_sessions']:raise ValueError('session count mismatch')
    # Full catalogue recorded independently of the validation labels in the run.
    catalogue=json.loads((run/'catalogue.json').read_text())
    for name,expected in report['models'].items():
        actual=ranking_metrics(targets,{r['session']:r['rankings'][name] for r in rows},catalogue)
        if actual!=expected:raise ValueError(f'saved metrics mismatch: {name}')
    recall=sum(r['target'] in r['pool'] for r in rows)/len(rows)
    if abs(recall-report['retrieval']['retrieval_recall'])>1e-12:raise ValueError('retrieval metric mismatch')
    samples=json.loads((run/'samples.json').read_text());lookup={r['session']:r for r in rows}
    for s in samples:
        r=lookup[s['session']]
        if s['target']!=r['target'] or s['rankings']!=r['rankings']:raise ValueError('sample changed saved predictions')
    return report,samples


def main():
    pointer=json.loads((ROOT/'artifacts/competition-dressipi.json').read_text());run=ROOT/'artifacts/competition-runs'/pointer['run_id']
    if not run.resolve().is_relative_to((ROOT/'artifacts/competition-runs').resolve()):raise ValueError('invalid path')
    if digest(run/'report.json')!=pointer['report_sha256']:raise ValueError('report pointer mismatch')
    report,samples=verify_run(run)
    version=hashlib.sha256((pointer['report_sha256']+digest(__file__)).encode()).hexdigest()[:16]
    folder=ROOT/'apps/web/dressipi-results'/version;folder.mkdir(parents=True,exist_ok=True);resources={}
    for key,value in [('report',report),('samples',{'run_id':report['run_id'],'samples':samples})]:
        write(folder/f'{key}.json',value);resources[key]={'path':f'{version}/{key}.json','sha256':digest(folder/f'{key}.json')}
    manifest={'schema':1,'run_id':report['run_id'],'version':version,'public_export_allowed':False,'resources':resources,'source_report_sha256':pointer['report_sha256']}
    tmp=folder.parent/'manifest.json.tmp';write(tmp,manifest);tmp.replace(folder.parent/'manifest.json')
    print(f'Verified and exported {report["run_id"]}: {len(samples)} fixed samples, local research only.')
if __name__=='__main__':main()

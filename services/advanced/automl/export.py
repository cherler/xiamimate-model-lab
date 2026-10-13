"""Publish only the verified report; weights, raw rows and training inputs stay local."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ROOT,sha,write,forecasts_metrics
import hashlib
from automl.verify import verify

p=json.loads((ROOT/'artifacts/advanced-automl.json').read_text());run=ROOT/'artifacts/advanced-runs'/p['run_id']
if sha(run/'report.json')!=p['report_sha256']:raise ValueError('AutoML report pointer mismatch')
r=verify(run)
# Predefined references remain visible, never reselect from replay outcomes.
truth=json.loads((run/'forecast-replay-rows.json').read_text())
ranking=ROOT/'artifacts/advanced-runs'/r['parents']['ranking']['run']/'report.json'
if sha(ranking)!=r['parents']['ranking']['sha256']:raise ValueError('Reference ranking changed')
r['reference_replay']={'recommendation':{'decay':json.loads(ranking.read_text())['aggregate']['decay']},'forecast':{id:forecasts_metrics([row['actual'] for row in truth],[row[id] for row in truth]) for id in ['last_week','weekday_median']}}
r['source_report_sha256']=sha(run/'report.json')
version=hashlib.sha256(json.dumps(r,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16];base=ROOT/'apps/web/selection-results';path=base/version/'report.json';write(path,r)
manifest=dict(version=version,run_id=run.name,path=f'{version}/report.json',sha256=sha(path))
write(base/'manifest.tmp',manifest);(base/'manifest.tmp').replace(base/'manifest.json');print('Exported selection',version)

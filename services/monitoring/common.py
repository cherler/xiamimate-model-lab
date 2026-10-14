import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'artifacts/monitoring-runs'
PUBLIC = ROOT / 'apps/web/monitoring-results'
CONFIG = Path(__file__).with_name('protocol.json')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def save(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':'), default=lambda v: v.tolist() if isinstance(v, np.ndarray) else v.item()) + '\n'
    tmp = path.with_suffix(path.suffix + '.tmp'); tmp.write_text(text); tmp.replace(path)


def create_run(kind):
    run_id = kind + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    dest = ART / run_id; dest.mkdir(parents=True, exist_ok=False)
    for name in ['protocol.json','common.py',kind+'.py']:
        (dest / name).write_bytes(Path(__file__).with_name(name).read_bytes())
    return run_id, dest


def export(kind, dest):
    case = dest / 'case.json'; digest = sha(case); p = load(case)
    folder = PUBLIC / digest[:16]; folder.mkdir(parents=True, exist_ok=True)
    (folder / (kind+'.json')).write_bytes(case.read_bytes())
    manifest = load(PUBLIC / 'manifest.json') if (PUBLIC / 'manifest.json').exists() else {'resources': {}}
    manifest['resources'][kind] = {'path':digest[:16]+'/'+kind+'.json','sha256':digest,'run_id':p['run_id']}
    save(PUBLIC / 'manifest.json', manifest)
    save(ROOT / f'artifacts/monitoring-{kind}.json', {'run_id':p['run_id']})
    print('Exported', kind, p['run_id'], digest, flush=True)

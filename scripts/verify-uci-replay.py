"""Cross-language equality: JS static playback against the original saved model API logic."""
import sys,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from services.publishing.uci import RUN,read,write,verify_source
from server import Artifacts

verify_source(ROOT/'artifacts/runs'/RUN)
with tempfile.TemporaryDirectory() as work:
    root=Path(work);(root/'artifacts').mkdir();(root/'artifacts/runs').symlink_to(ROOT/'artifacts/runs',target_is_directory=True);write(root/'artifacts/latest.json',{'run_id':RUN});store=Artifacts(root).load()
    process=subprocess.Popen(['node',str(ROOT/'scripts/uci-replay-cases.mjs')],stdout=subprocess.PIPE,text=True,cwd=ROOT)
    count=0
    try:
        for line in process.stdout:
            row=__import__('json').loads(line);expected=store.recommend(row['body']);expected.pop('elapsed_ms');actual=row['result'];actual.pop('replay')
            if actual!=expected:raise ValueError('Replay differs from saved model: '+str(row['body']))
            count+=1
        if process.wait()!=0:raise RuntimeError('JS verification process failed')
    finally:
        if process.poll() is None:process.terminate();process.wait()
    if count!=4950:raise ValueError('Incomplete verification coverage')
    print('Verified all 4950 settings: exact IDs, order, scores, explanations, history and fallback; original model weights unchanged.')

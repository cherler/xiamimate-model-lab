"""Fetch only pinned official reference routines and verify every byte."""
import json,urllib.request,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def prepare():
    spec=json.loads(Path(__file__).with_name('colbert-reference.json').read_text())
    folder=ROOT/'artifacts/colbert-reference'/spec['revision']
    for name,digest in spec['files'].items():
        path=folder/name
        if path.exists():data=path.read_bytes()
        else:
            with urllib.request.urlopen(f"https://raw.githubusercontent.com/stanford-futuredata/ColBERT/{spec['revision']}/{name}",timeout=30) as response:data=response.read()
        if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Official source mismatch: '+name)
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    print('Verified pinned official reference',spec['revision'])
if __name__=='__main__':prepare()

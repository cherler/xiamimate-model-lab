"""Pinned third-party mirror import for user-requested local research only.

Only three training files. Code licenses are not treated as dataset licenses.
No account form or terms acceptance; no automatic public export.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.competitions.m5_data import ROOT,digest,write
COMMIT='e91a0ef5d84aab5e000746b6da9e4e0e5ee615ec'
REPO='yuanhenglee/RecSys-Dressipi'
FILES={
 'item_features.csv':(5836477,'00a42ae11d0e98d5c124a5a2632fc27e6786dcd6ccc8a5360786afd877595c13','media'),
 'train_purchases.csv':(37245969,'07fc2af7130f74ce22697c084d4ff27d01b2d30fdce4f5c539d45445c6b8a7aa','raw'),
 'train_sessions.csv':(176697963,'b4b835d095481c696921f08e1c9db2024287a6814ab90ed5851fa5d01feebc61','media'),
}
RAW=ROOT/'data/raw/dressipi'

def prepare():
 RAW.mkdir(parents=True,exist_ok=True)
 for name,(size,sha,host) in FILES.items():
  path=RAW/name
  if path.exists() and path.stat().st_size==size and digest(path)==sha:continue
  url=(f'https://media.githubusercontent.com/media/{REPO}/{COMMIT}/dataset/{name}' if host=='media' else f'https://raw.githubusercontent.com/{REPO}/{COMMIT}/dataset/{name}')
  parts=RAW/(name+'.parts');parts.mkdir(exist_ok=True);chunk=1024*1024
  # GitHub's public LFS endpoint returns a short-lived download URL. Never persist/log it.
  if host=='media':
   payload=json.dumps({'operation':'download','transfers':['basic'],'objects':[{'oid':sha,'size':size}]}).encode()
   request=urllib.request.Request(f'https://github.com/{REPO}.git/info/lfs/objects/batch',data=payload,headers={'Accept':'application/vnd.git-lfs+json','Content-Type':'application/vnd.git-lfs+json'})
   with urllib.request.urlopen(request,timeout=30) as response:action=json.load(response)['objects'][0]['actions']['download']
   url=action['href']
  else:action={}

  def fetch(start):
   stop=min(size,start+chunk)-1;part=parts/str(start)
   if part.exists() and part.stat().st_size==stop-start+1:return part
   partial=parts/f'{start}.partial';fragment=parts/f'{start}.fragment';headers=parts/f'{start}.headers'
   for attempt in range(12):
    have=partial.stat().st_size if partial.exists() else 0
    if have==stop-start+1:partial.replace(part);return part
    if have>stop-start+1:raise ValueError('oversized saved partial')
    begin=start+have
    args=['curl','-f','-L','--max-time','30','-sS','-r',f'{begin}-{stop}','-D',str(headers),url,'-o',str(fragment)]
    for key,value in action.get('header',{}).items():args.extend(['-H',f'{key}: {value}'])
    result=subprocess.run(args,capture_output=True)
    valid=headers.exists() and re.search(rf'content-range:\s*bytes {begin}-{stop}/{size}\s',headers.read_text(),re.I)
    if valid and fragment.exists() and 0<fragment.stat().st_size<=stop-begin+1:
     with partial.open('ab') as out:out.write(fragment.read_bytes())
    elif result.returncode not in [5,6,7,18,28,35,52,55,56]:raise ValueError(f'chunk {start}: invalid range response ({result.returncode})')
   if partial.exists() and partial.stat().st_size==stop-start+1:partial.replace(part);return part
   raise ValueError(f'chunk {start} incomplete; verified-range partial retained for resume')
  with ThreadPoolExecutor(max_workers=10) as pool:paths=list(pool.map(fetch,range(0,size,chunk)))
  tmp=RAW/(name+'.tmp')
  with tmp.open('wb') as out:
   for part in paths:out.write(part.read_bytes())
  if digest(tmp)!=sha:raise ValueError(f'{name} differs from pinned source')
  tmp.replace(path)
 source={'mode':'local_research_only','public_export_allowed':False,'mirror':f'https://github.com/{REPO}',
         'commit':COMMIT,'official':'https://www.recsyschallenge.com/2022/',
         'rights_reference':'https://groups.google.com/g/recsys-challenge-2022/c/_ga1adC7oeI',
         'rights_note':'Organizer announced CC BY-NC-SA for research/education in July 2022. Mirror is not an independent rights grant; commercial lead-generation distribution is not cleared. No third-party scores used.',
         'integrity_note':'LFS SHA256 for sessions/features; purchases matched pinned Git blob 84b613bd8b4fac448b2371238ce553a912039553. Identity to a separately obtained official archive has not been checked.',
         'files':{name:{'bytes':size,'sha256':digest(RAW/name)} for name,(size,_,_) in FILES.items()},'official_test_files_downloaded':False}
 write(RAW/'source.json',source);print('Dressipi training mirror verified; local research only.',flush=True)
if __name__=='__main__':prepare()

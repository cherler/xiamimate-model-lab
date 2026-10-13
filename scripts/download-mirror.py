"""Optional faster public mirror download, conditional on a pinned GitHub ETag.

Fetched as byte ranges; assembled input must match an independent complete SHA-256.
This is an explicit alternative to the default original UCI download.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request, hashlib, time
root=Path(__file__).resolve().parents[1] / 'data/raw'
root.mkdir(parents=True,exist_ok=True)
size=45622278
url='https://api.github.com/repos/bonifasiusx/lrfm-analysis-online-retail-store/contents/online_retail_II.xlsx'
chunk_size=6_000_000
chunks=[(start,min(start+chunk_size,size)-1) for start in range(0,size,chunk_size)]
def get(pair):
    start,end=pair
    file=root/f'github-chunk-{start}.part'
    for attempt in range(3):
        try:
            request=urllib.request.Request(url,headers={'Accept':'application/vnd.github.raw+json','Range':f'bytes={start}-{end}','If-Match':'"47b49d0acea9a5b1895997e9df1fc435c42addc9"'})
            with urllib.request.urlopen(request,timeout=60) as response:
                assert response.status==206
                assert response.headers['Content-Range']==f'bytes {start}-{end}/{size}'
                with file.open('wb') as out:
                    while data:=response.read(256*1024):out.write(data)
            assert file.stat().st_size==end-start+1
            print('Downloaded chunk',start,end,flush=True)
            return file
        except Exception as e:
            print('Retry',start,str(e),flush=True)
            if attempt==2:raise
            time.sleep(2)
with ThreadPoolExecutor(max_workers=8) as pool:
    files=list(pool.map(get,chunks))
out=root/'verified-mirror.xlsx.part'
with out.open('wb') as target:
    for file in files:target.write(file.read_bytes())
digest=hashlib.sha256(out.read_bytes()).hexdigest()
assert digest=='bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980',digest
out.replace(root/'verified-mirror.xlsx')
print('Complete; SHA-256 matches independently published HF LFS checksum:',digest,flush=True)

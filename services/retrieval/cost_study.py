"""E10 full-corpus, fixed-budget CPU retrieval cost experiment."""
import argparse
import hashlib
import platform
import resource
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import torch
from scipy import sparse
from sentence_transformers import SentenceTransformer
from huggingface_hub import snapshot_download
from threadpoolctl import threadpool_limits, threadpool_info
from .run import ROOT, load, save, sha
from .core import BM25, ordered, fuse, metrics
from .colbert_encoder import Encoder, chunks, query_prefix
from .cost_audit import CONFIG, AUDIT

RUNS=ROOT/'artifacts/retrieval-cost-runs'
POINTER=ROOT/'artifacts/retrieval-cost-latest.json'
PUBLIC=ROOT/'apps/web/retrieval-cost-results'
RECORD=ROOT/'docs/evaluation/retrieval-cost-export-v1.json'
FILES=['services/retrieval/cost_study.py','services/retrieval/cost_audit.py','services/retrieval/core.py','services/retrieval/colbert_encoder.py','services/retrieval/uv.lock']


def file_hash(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()


def code_hashes():return {f:file_hash(ROOT/f) for f in FILES}


def maxsim(q, vectors, mask):
    with torch.inference_mode():
        scores=vectors@q.T
        return scores.masked_fill(~mask[:,:,None],-1e4).max(dim=1).values.sum(dim=1)


def document_scores(q,index,doc_positions=None,block=64):
    n=len(index['docchunks']); full=doc_positions is None
    positions=list(range(n)) if full else doc_positions
    chunks_to_use=list(range(len(index['vectors']))) if full else [i for d in positions for i in index['docchunks'][d]]
    out=np.full(n,-np.inf,dtype=np.float64)
    for start in range(0,len(chunks_to_use),block):
        ids=chunks_to_use[start:start+block]
        if full:v=index['vectors'][start:start+block];mask=index['mask'][start:start+block]
        else:v=index['vectors'][ids];mask=index['mask'][ids]
        values=maxsim(q,v,mask).numpy()
        np.maximum.at(out,index['chunkdocs'][ids],values)
    return out


def summaries(rows,cfg):
    names=cfg['methods'];summary={m:{k:float(np.mean([r['metrics'][m][k] for r in rows])) for k in rows[0]['metrics'][m]} for m in names}
    timings={m:{'p50_ms':float(np.median([r['timing'][m]['total_ms'] for r in rows])),
        'p95_ms':float(np.quantile([r['timing'][m]['total_ms'] for r in rows],.95)),
        'components_mean_ms':{k:float(np.mean([r['timing'][m]['components_ms'].get(k,0) for r in rows])) for k in sorted({k for r in rows for k in r['timing'][m]['components_ms']})}} for m in names}
    comparisons=[]
    for a,b in cfg['comparisons']:
        delta=np.array([r['metrics'][a]['ndcg_at_10']-r['metrics'][b]['ndcg_at_10'] for r in rows]);rng=np.random.default_rng(cfg['seed'])
        means=delta[rng.integers(len(rows),size=(2000,len(rows)))].mean(1)
        comparisons.append({'a':a,'b':b,'delta':float(delta.mean()),'wins':int((delta>1e-12).sum()),'losses':int((delta< -1e-12).sum()),
            'ties':int((np.abs(delta)<=1e-12).sum()),'ci95':np.quantile(means,[.025,.975]).tolist(),
            'gained_targets10':sum(len(set(r['relevant'])&set(r['rankings'][a][:10])-set(r['rankings'][b][:10])) for r in rows),
            'lost_targets10':sum(len(set(r['relevant'])&set(r['rankings'][b][:10])-set(r['rankings'][a][:10])) for r in rows)})
    outside={m:{'found10':sum(len(set(r['outside50'])&set(r['rankings'][m][:10])) for r in rows),
                'found100':sum(len(set(r['outside50'])&set(r['rankings'][m])) for r in rows)} for m in names}
    return {'metrics':summary,'timing':timings,'comparisons':comparisons,'outside50':outside}


def build_indexes(dest,parent,ccfg,cfg):
    docs=load(parent/'documents.json');ids=sorted(docs);texts=[docs[d]['title']+' '+docs[d]['text'] for d in ids]
    base=load(parent/'protocol.json');cost={};t=time.perf_counter()
    dense_path=Path(snapshot_download(base['dense']['model'],revision=base['dense']['revision'],local_files_only=True))
    dense=SentenceTransformer(str(dense_path),device='cpu',trust_remote_code=False,local_files_only=True);dense.max_seq_length=256
    enc=Encoder(ccfg);cost['model_load_seconds']=time.perf_counter()-t
    t=time.perf_counter();dense.encode(['A scientific document.'],normalize_embeddings=True,show_progress_bar=False);enc.encode(['A scientific document.']);enc.encode(['A query.'],True);cost['warmup_seconds']=time.perf_counter()-t
    t=time.perf_counter();bm=BM25(texts,k1=base['bm25']['k1'],b=base['bm25']['b']);cost['bm25_build_seconds']=time.perf_counter()-t
    t=time.perf_counter();dv=dense.encode(texts,batch_size=32,normalize_embeddings=True,show_progress_bar=False).astype(np.float32);cost['dense_encode_seconds']=time.perf_counter()-t
    sparse.save_npz(dest/'bm25.npz',bm.matrix);save(dest/'vocabulary.json',bm.vocab);np.save(dest/'dense.npy',dv)
    t=time.perf_counter();spans={d:chunks(text,enc.tok,160,128) for d,text in zip(ids,texts)};cost['colbert_chunk_seconds']=time.perf_counter()-t
    alltexts=[];docchunks=[];chunkdocs=[]
    for j,d in enumerate(ids):
        docchunks.append(list(range(len(alltexts),len(alltexts)+len(spans[d]))));alltexts.extend(x['text'] for x in spans[d]);chunkdocs.extend([j]*len(spans[d]))
    index={'vectors':torch.zeros((len(alltexts),163,128),dtype=torch.float32),'mask':torch.zeros((len(alltexts),163),dtype=torch.bool),
           'docchunks':docchunks,'chunkdocs':np.array(chunkdocs,dtype=np.int32)}
    t=time.perf_counter()
    for start in range(0,len(alltexts),cfg['batch_size']):
        vectors,_=enc.encode(alltexts[start:start+cfg['batch_size']])
        for offset,v in enumerate(vectors):
            if len(v)>163:raise ValueError('Unexpected token budget')
            index['vectors'][start+offset,:len(v)]=v;index['mask'][start+offset,:len(v)]=True
        if start%1600==0:print(f'Encoded full corpus chunks {start}/{len(alltexts)}',flush=True)
    cost['colbert_encode_seconds']=time.perf_counter()-t
    t=time.perf_counter();torch.save(index,dest/'index.pt');save(dest/'chunks.json',spans);cost['colbert_serialize_seconds']=time.perf_counter()-t
    cost['bytes']={f:(dest/f).stat().st_size for f in ['bm25.npz','vocabulary.json','dense.npy','index.pt','chunks.json']}
    cost['source_text_bytes']=(parent/'documents.json').stat().st_size
    cost['colbert_tensor_bytes']=index['vectors'].nelement()*4+index['mask'].nelement()
    cost['colbert_unpadded_vector_bytes']=int(index['mask'].sum())*128*4
    cost['model_weight_bytes']={key:sum(f.stat().st_size for f in path.rglob('*.safetensors')) for key,path in [('dense',dense_path),('colbert',enc.path)]}
    cost['documents']=len(ids);cost['chunks']=len(alltexts)
    return ids,dense,dv,bm,enc,index,cost


def run():
    if POINTER.exists():raise ValueError('E10 run exists; verify it instead of repeating selection')
    cfg=load(CONFIG);audit=load(AUDIT)
    if audit['protocol_sha256']!=sha(CONFIG.read_bytes()) or audit['auditor_sha256']!=file_hash(Path(__file__).with_name('cost_audit.py')):raise ValueError('Audit/protocol changed')
    parent=ROOT/'artifacts/retrieval-runs'/cfg['parent_run'];colbert=ROOT/'artifacts/colbert-runs'/cfg['colbert_run']
    if file_hash(parent/'case.json')!=audit['parent_sha256'] or file_hash(colbert/'case.json')!=audit['colbert_sha256']:raise ValueError('Parent results changed')
    # Load only label-free query records during new ranking. Audit already used known labels, explicitly documented.
    queries=load(parent/'rankings.json');ccfg=load(colbert/'colbert-study-protocol.json')
    dest=RUNS/('retrieval-cost-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));dest.mkdir(parents=True,exist_ok=False)
    save(POINTER,{'run_id':dest.name,'stage':'ranking'});save(dest/'protocol.json',cfg)
    torch.set_num_threads(cfg['threads']);torch.manual_seed(cfg['seed'])
    with threadpool_limits(limits=cfg['threads']):
        ids,dense,dv,bm,enc,index,cost=build_indexes(dest,parent,ccfg,cfg)
        lookup={d:i for i,d in enumerate(ids)};rows=[];saved_scores={m:[] for m in ['bm25','dense','colbert']};qvectors=[]
        for number,q in enumerate(queries):
            rankings={};timing={};arrays={}
            for method in cfg['methods'][::1 if number%2==0 else -1]:
                components={};start=time.perf_counter();last=start
                def tick(key):
                    nonlocal last
                    now=time.perf_counter();components[key]=(now-last)*1000;last=now
                if method!='colbert_full':
                    bs=bm.score(q['text']);a=ordered(ids,bs);tick('bm25')
                    if method=='bm25':ranking=a;arrays['bm25']=bs
                    else:
                        v=dense.encode([q['text']],normalize_embeddings=True,show_progress_bar=False)[0];tick('dense_query_encode')
                        ds=dv@v;b=ordered(ids,ds);tick('dense_scan_sort');h=fuse(a,b);tick('fusion');ranking=h;arrays['dense']=ds
                if method.startswith('colbert'):
                    text=query_prefix(q['text'],enc.tok,61);qv,_=enc.encode([text],True);tick('colbert_query_encode')
                    pool=None if method=='colbert_full' else [lookup[d] for d,_ in h[:50 if method=='colbert50' else 100]]
                    scores=document_scores(qv[0],index,pool,cfg['score_block']);tick('colbert_scan')
                    if pool is None:ranking=ordered(ids,scores);arrays['colbert']=scores;qvector=qv[0].numpy()
                    else:
                        chosen=[ids[i] for i in pool];ranking=ordered(chosen,scores[pool],len(pool))+(h[50:] if method=='colbert50' else [])
                    tick('colbert_sort')
                timing[method]={'total_ms':(time.perf_counter()-start)*1000,'components_ms':components};rankings[method]=[d for d,_ in ranking]
            for m in saved_scores:saved_scores[m].append(arrays[m])
            qvectors.append(qvector)
            rows.append({'id':q['id'],'text':q['text'],'rankings':rankings,'timing':timing})
            if (number+1)%10==0:print(f'Complete pipelines {number+1}/300; full scan {timing["colbert_full"]["total_ms"]:.1f}ms',flush=True)
        save(dest/'rankings.json',rows);np.savez_compressed(dest/'scores.npz',**{k:np.array(v) for k,v in saved_scores.items()},queries=np.array(qvectors))
        environment={'platform':platform.platform(),'processor':platform.processor(),'python':platform.python_version(),'torch':torch.__version__,'threads':torch.get_num_threads(),'threadpools':threadpool_info()}
    cost['peak_process_rss_bytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)
    frozen={'run_id':dest.name,'protocol':cfg,'protocol_sha256':file_hash(CONFIG),'audit_sha256':file_hash(AUDIT),'code_sha256':code_hashes(),
        'parent_sha256':audit['parent_sha256'],'colbert_sha256':audit['colbert_sha256'],'costs':cost,'environment':environment,
        'files':{f:file_hash(dest/f) for f in ['rankings.json','scores.npz','index.pt','dense.npy','bm25.npz','vocabulary.json','chunks.json']},
        'colbert_weight_sha256':file_hash(enc.path/'model.safetensors')}
    save(dest/'frozen.json',frozen)
    save(dest/'label-access.json',{'at':datetime.now(timezone.utc).isoformat(),'frozen_sha256':file_hash(dest/'frozen.json'),'scope':cfg['scope'],'source':'previously scored parent case; no new independent test'})
    scored=load(parent/'case.json');byid={q['id']:q for q in scored['queries']}
    for r in rows:
        r['relevant']=byid[r['id']]['relevant'];r['outside50']=[d for d in r['relevant'] if d not in r['rankings']['hybrid'][:50]]
        r['metrics']={m:metrics(r['rankings'][m],r['relevant']) for m in cfg['methods']}
    payload={'schema':cfg['version'],**frozen,'audit_summary':audit['summary'],'rows':rows,'summary':summaries(rows,cfg),
        'notice':load(colbert/'case.json')['notice'],'access':load(dest/'label-access.json')}
    save(dest/'case.json',payload);save(POINTER,{'run_id':dest.name,'stage':'complete'})
    verify()


def verify():
    pointer=load(POINTER)
    if pointer['stage']!='complete':raise ValueError('E10 incomplete')
    dest=RUNS/pointer['run_id'];p=load(dest/'case.json');f=load(dest/'frozen.json');cfg=load(CONFIG);audit=load(AUDIT)
    if p['code_sha256']!=code_hashes() or p['protocol_sha256']!=file_hash(CONFIG) or p['audit_sha256']!=file_hash(AUDIT):raise ValueError('Frozen E10 code/protocol changed')
    if p['access']['frozen_sha256']!=file_hash(dest/'frozen.json'):raise ValueError('Freeze changed after scoring')
    for key,value in f.items():
        if p[key]!=value:raise ValueError('Scored payload changed frozen metadata')
    for name,digest in f['files'].items():
        if file_hash(dest/name)!=digest:raise ValueError('Frozen artifact changed: '+name)
    parent=ROOT/'artifacts/retrieval-runs'/cfg['parent_run'];colbert=ROOT/'artifacts/colbert-runs'/cfg['colbert_run']
    if file_hash(parent/'case.json')!=audit['parent_sha256'] or file_hash(colbert/'case.json')!=audit['colbert_sha256']:raise ValueError('Parent changed')
    original=load(parent/'case.json');ids=sorted(original['documents']);parents={q['id']:q for q in original['queries']};saved=load(dest/'rankings.json');scores=np.load(dest/'scores.npz',allow_pickle=False)
    if len(p['rows'])!=300 or [q['id'] for q in p['rows']]!=[q['id'] for q in original['queries']]:raise ValueError('Query scope changed')
    for i,(r,old) in enumerate(zip(p['rows'],saved)):
        if {k:v for k,v in r.items() if k not in ['relevant','outside50','metrics']}!=old:raise ValueError('Ranking/timing changed after labels')
        if r['relevant']!=parents[r['id']]['relevant']:raise ValueError('Relevance changed')
        bm=ordered(ids,scores['bm25'][i]);dense=ordered(ids,scores['dense'][i]);hybrid=fuse(bm,dense);full=ordered(ids,scores['colbert'][i]);lookup=dict(zip(ids,scores['colbert'][i]))
        expected={'bm25':bm,'hybrid':hybrid,'colbert_full':full}
        for n in [50,100]:
            pool=[d for d,_ in hybrid[:n]];expected['colbert'+str(n)]=ordered(pool,np.array([lookup[d] for d in pool]),n)+(hybrid[50:] if n==50 else [])
        for m in cfg['methods']:
            if r['rankings'][m]!=[d for d,_ in expected[m]] or r['metrics'][m]!=metrics(r['rankings'][m],r['relevant']):raise ValueError('Ranking/metric reconstruction failed')
            t=r['timing'][m]
            if t['total_ms']<sum(t['components_ms'].values()) or any(not np.isfinite(x) or x<0 for x in [t['total_ms'],*t['components_ms'].values()]):raise ValueError('Invalid actual pipeline timing')
    if p['summary']!=summaries(p['rows'],cfg):raise ValueError('Summary mismatch')
    # Six IDs fixed by position, never by relevance/result. Check saved query vectors against every document.
    torch.set_num_threads(cfg['threads']);index=torch.load(dest/'index.pt',map_location='cpu',weights_only=False)
    for i in [0,59,119,179,239,299]:
        actual=document_scores(torch.from_numpy(scores['queries'][i]),index,block=cfg['score_block'])
        np.testing.assert_allclose(actual,scores['colbert'][i],rtol=1e-6,atol=1e-5)
    digest=file_hash(dest/'case.json');PUBLIC.mkdir(parents=True,exist_ok=True);(PUBLIC/(digest+'.json')).write_bytes((dest/'case.json').read_bytes())
    manifest={'path':digest+'.json','sha256':digest,'run_id':p['run_id'],'parent_run':cfg['parent_run']};save(PUBLIC/'manifest.json',manifest)
    record={**manifest,'summary':p['summary'],'costs':p['costs'],'verification':'All rankings/metrics from saved full scores, frozen artifact hashes; six fixed query vectors recomputed against all5183 documents. No retraining or new selection.'}
    if RECORD.exists() and load(RECORD)!=record:raise ValueError('Published evidence changed')
    save(RECORD,record);print('Verified '+p['run_id'],flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['run','verify']);args=parser.parse_args()
    run() if args.action=='run' else verify()

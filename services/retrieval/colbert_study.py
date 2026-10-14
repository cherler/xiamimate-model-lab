"""Frozen 300-query same-pool development study. Never tune from its scores."""
import csv,io,json,time,zipfile,sys,platform,resource
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
import torch
from sentence_transformers import CrossEncoder
from huggingface_hub import snapshot_download
from .run import ROOT,save,load,sha,NOTICE
from .core import metrics,ordered
from .colbert_encoder import Encoder,chunks,query_prefix,reference_parity
CONFIG=Path(__file__).with_name('colbert-study-protocol.json')
METHODS=['parent_hybrid','parent_rerank','cross_first','cross_chunks','colbert_first','colbert_chunks']

def aggregate(rows):return {m:{k:float(np.mean([r['metrics'][m][k] for r in rows])) for k in rows[0]['metrics'][m]} for m in METHODS} if rows else None

def run():
    cfg=load(CONFIG);parent=ROOT/'artifacts/retrieval-runs'/cfg['parent_run'];f=load(parent/'frozen.json')
    for name,key in [('rankings.json','rankings_sha256'),('documents.json','documents_sha256')]:
        if sha((parent/name).read_bytes())!=f[key]:raise ValueError('Parent source mismatch')
    dest=ROOT/'artifacts/colbert-runs'/('colbert-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));dest.mkdir(parents=True)
    for file in [CONFIG,Path(__file__),Path(__file__).with_name('colbert_encoder.py'),Path(__file__).with_name('colbert-reference.json'),Path(__file__).with_name('uv.lock')]: (dest/file.name).write_bytes(file.read_bytes())
    torch.set_num_threads(cfg['threads']);torch.manual_seed(42);enc=Encoder(cfg);parity=reference_parity(enc);save(dest/'core-parity.json',parity)
    original=load(parent/'rankings.json');docs=load(parent/'documents.json')
    ids=sorted({d for r in original for d in r['rankings']['hybrid'][:50]})
    allchunks=[];docchunks={};spans={}
    for did in ids:
        spans[did]=chunks(docs[did]['title']+' '+docs[did]['text'],enc.tok,cfg['chunk_tokens'],cfg['chunk_stride'])
        docchunks[did]=list(range(len(allchunks),len(allchunks)+len(spans[did])));allchunks.extend(r['text'] for r in spans[did])
    save(dest/'chunks.json',spans)
    enc.encode(allchunks[:cfg['batch_size']]);vectors=[];tokenids=[];t=time.perf_counter()
    for i in range(0,len(allchunks),cfg['batch_size']):
        v,k=enc.encode(allchunks[i:i+cfg['batch_size']]);vectors.extend(v);tokenids.extend(k)
        if i%1600==0:print('Encoded',i,'/',len(allchunks),flush=True)
    index_seconds=time.perf_counter()-t;vector_bytes=sum(v.nelement()*v.element_size() for v in vectors)
    # Persist vectors for explanations and reproducibility; no approximate or compressed index.
    torch.save({'vectors':vectors,'tokenids':tokenids,'docchunks':docchunks},dest/'vectors.pt')
    cross_cfg=f['protocol']['reranker'];cross_path=snapshot_download(cross_cfg['model'],revision=cross_cfg['revision'],local_files_only=True)
    cross=CrossEncoder(cross_path,device='cpu',max_length=256,activation_fn=torch.nn.Identity(),trust_remote_code=False,local_files_only=True)
    if enc.tok.get_vocab()!=cross.tokenizer.get_vocab():raise ValueError('Controlled WordPiece vocabulary differs')
    cross.predict([('A short query.',allchunks[0])],show_progress_bar=False)
    rows=[]
    for number,r in enumerate(original):
        pool=r['rankings']['hybrid'][:50];tail=r['rankings']['hybrid'][50:100];qtext=query_prefix(r['text'],enc.tok,cfg['query_maxlen']-3)
        t=time.perf_counter();qv,qids=enc.encode([qtext],True);q=qv[0];encode_ms=(time.perf_counter()-t)*1000
        scores={m:[] for m in ['colbert_first','colbert_chunks','cross_first','cross_chunks']};best={};token_matches={}
        t=time.perf_counter()
        for did in pool:scores['colbert_first'].append(float((q@vectors[docchunks[did][0]].T).max(1).values.sum()))
        first_ms=(time.perf_counter()-t)*1000
        t=time.perf_counter()
        for did in pool:
            values=[float((q@vectors[i].T).max(1).values.sum()) for i in docchunks[did]];j=int(np.argmax(values));scores['colbert_chunks'].append(values[j]);best[did]=j
        chunk_ms=(time.perf_counter()-t)*1000
        t=time.perf_counter();scores['cross_first']=cross.predict([(qtext,allchunks[docchunks[d][0]]) for d in pool],batch_size=32,show_progress_bar=False).reshape(-1).tolist();cross_first_ms=(time.perf_counter()-t)*1000
        pairs=[(qtext,allchunks[i]) for d in pool for i in docchunks[d]]
        if any(len(cross.tokenizer(a,b,truncation=False).input_ids)>256 for a,b in pairs):raise ValueError('Controlled cross text would truncate')
        t=time.perf_counter();cs=cross.predict(pairs,batch_size=32,show_progress_bar=False).reshape(-1);cross_chunk_ms=(time.perf_counter()-t)*1000;offset=0
        cross_best={}
        for did in pool:
            length=len(docchunks[did]);segment=cs[offset:offset+length];scores['cross_chunks'].append(float(segment.max()));cross_best[did]=int(segment.argmax());offset+=length
        rankings={'parent_hybrid':r['rankings']['hybrid'],'parent_rerank':r['rankings']['rerank']}
        rankings.update({m:[d for d,_ in ordered(pool,ss,50)]+tail for m,ss in scores.items()})
        for did in rankings['colbert_chunks'][:3]:
            idx=docchunks[did][best[did]];vals,pos=(q@vectors[idx].T).max(1);total=float(vals.sum());np.testing.assert_allclose(total,scores['colbert_chunks'][pool.index(did)],rtol=1e-5)
            token_matches[did]={'chunk':spans[did][best[did]],'chunk_index':best[did],'chunk_count':len(docchunks[did]),'score':total,'tokens':[{'q':enc.tok.convert_ids_to_tokens(qi),'d':enc.tok.convert_ids_to_tokens(tokenids[idx][int(pi)]),'v':float(v)} for qi,pi,v in zip(qids[0],pos,vals)]}
        rows.append({'id':r['id'],'text':r['text'],'used_query':qtext,'query_wordpieces':len(enc.tok(r['text'],add_special_tokens=False).input_ids),
            'pool_multichunk_share':float(np.mean([len(docchunks[d])>1 for d in pool])),'rankings':rankings,'scores':{m:dict(zip(pool,ss)) for m,ss in scores.items()},
            'best_chunks':best,'cross_best_chunks':cross_best,'matches':token_matches,
            'milliseconds':{'colbert_first':encode_ms+first_ms,'colbert_chunks':encode_ms+chunk_ms,'cross_first':cross_first_ms,'cross_chunks':cross_chunk_ms}})
        if (number+1)%25==0:print('Ranked',number+1,'/300',flush=True)
    frozen={'run_id':dest.name,'protocol':cfg,'core_parity':parity,'parent_sha256':sha((parent/'case.json').read_bytes()),'parent_rankings_sha256':f['rankings_sha256'],
        'environment':{'python':platform.python_version(),'torch':torch.__version__,'platform':platform.platform(),'threads':cfg['threads']},
        'model_weight_sha256':sha((enc.path/'model.safetensors').read_bytes()),'source_sha256':{n:sha((dest/n).read_bytes()) for n in ['colbert-study-protocol.json','colbert_study.py','colbert_encoder.py','uv.lock']},
        'costs':{'candidate_documents':len(ids),'chunks':len(allchunks),'colbert_encoding_seconds':index_seconds,'float32_vector_bytes':vector_bytes,'saved_vector_file_bytes':(dest/'vectors.pt').stat().st_size,'peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)},'rows':rows,'titles':{d:docs[d]['title'] for d in ids}}
    save(dest/'frozen.json',frozen);save(dest/'frozen-hash.json',{'sha256':sha((dest/'frozen.json').read_bytes())});score(dest,parent,f);export(dest)
    save(ROOT/'artifacts/colbert-latest.json',{'run_id':dest.name})

def score(dest,parent,parent_frozen,resume=False):
    p=load(dest/'frozen.json');digest=sha((dest/'frozen.json').read_bytes())
    if digest!=load(dest/'frozen-hash.json')['sha256'] or sha((parent/'case.json').read_bytes())!=p['parent_sha256']:raise ValueError('Frozen input mismatch')
    if resume:
        ledger=load(dest/'development-label-access.json')
        if ledger['frozen_sha256']!=digest:raise ValueError('Resume inputs changed')
        save(dest/'scoring-recovery.json',{'reason':'Original scoring failed at missing notice field after ranking freeze; reuse exactly same rankings and known labels. No reranking or tuning.', 'at':datetime.now(timezone.utc).isoformat(),'postprocessing_sha256':sha(Path(__file__).read_bytes())})
    else:
        with (dest/'development-label-access.json').open('x') as out:json.dump({'purpose':'known benchmark development, not independent test','frozen_sha256':sha((dest/'frozen.json').read_bytes()),'at':datetime.now(timezone.utc).isoformat()},out)
    with zipfile.ZipFile(ROOT/'data/raw/retrieval/scifact.zip') as z:b=z.read('scifact/qrels/test.tsv')
    if sha(b)!=parent_frozen['source_hashes']['qrels/test.tsv']:raise ValueError('Label version mismatch')
    rel={}
    for r in csv.DictReader(io.StringIO(b.decode()),delimiter='\t'):
        if int(r['score'])>0:rel.setdefault(r['query-id'],{})[r['corpus-id']]=int(r['score'])
    for r in p['rows']:
        r['relevant']=rel[r['id']];r['metrics']={m:metrics(r['rankings'][m],r['relevant']) for m in METHODS};r['candidate_recall']=sum(d in rel[r['id']] for d in r['rankings']['parent_hybrid'][:50])/len(rel[r['id']])
    p['summary']=aggregate(p['rows']);p['groups']={}
    for name,condition in [('short_query',lambda r:r['query_wordpieces']<=29),('long_query',lambda r:r['query_wordpieces']>29),('pool_mostly_multichunk',lambda r:r['pool_multichunk_share']>=.8),('other_pool',lambda r:r['pool_multichunk_share']<.8)]:
        rows=[r for r in p['rows'] if condition(r)];p['groups'][name]={'n':len(rows),'metrics':aggregate(rows)}
    p['comparisons']=[]
    for a,b in [('colbert_first','cross_first'),('colbert_chunks','cross_chunks'),('colbert_chunks','colbert_first'),('cross_chunks','cross_first')]:
        delta=np.array([r['metrics'][a]['ndcg_at_10']-r['metrics'][b]['ndcg_at_10'] for r in p['rows']]);rng=np.random.default_rng(42);means=delta[rng.integers(len(delta),size=(2000,len(delta)))].mean(1)
        p['comparisons'].append({'model':a,'baseline':b,'ndcg_delta':float(delta.mean()),'bootstrap_ci95':np.quantile(means,[.025,.975]).tolist(),'wins':int((delta>1e-12).sum()),'losses':int((delta< -1e-12).sum()),'ties':int((np.abs(delta)<=1e-12).sum())})
    p['timing']={m:{'median':float(np.median([r['milliseconds'][m] for r in p['rows']])),'p95':float(np.quantile([r['milliseconds'][m] for r in p['rows']],.95))} for m in ['cross_first','cross_chunks','colbert_first','colbert_chunks']}
    p['notice']=NOTICE+'\nAdditional development adaptation: fixed-pool ColBERTv2/Minilm chunking study; no fine-tuning. ColBERT code/checkpoint MIT; model weights not distributed.\n'+(ROOT/'artifacts/colbert-reference'/p['core_parity']['reference']['revision']/'LICENSE').read_text()
    p['frozen_sha256']=sha((dest/'frozen.json').read_bytes());save(dest/'case.json',p);print(json.dumps(p['summary'],indent=2),flush=True)

def export(dest):
    p=load(dest/'case.json');f=load(dest/'frozen.json')
    if len(p['rows'])!=len(f['rows']):raise ValueError('Missing ranked queries')
    if sha((dest/'frozen.json').read_bytes())!=p['frozen_sha256']:raise ValueError('Frozen rankings changed')
    for r,old in zip(p['rows'],f['rows']):
        if {k:v for k,v in r.items() if k not in ['relevant','metrics','candidate_recall']}!=old:raise ValueError('Ranking changed after scoring')
        for m in METHODS:
            if metrics(r['rankings'][m],r['relevant'])!=r['metrics'][m]:raise ValueError('Score mismatch')
    if aggregate(p['rows'])!=p['summary']:raise ValueError('Aggregate mismatch')
    digest=sha((dest/'case.json').read_bytes());folder=ROOT/'apps/web/colbert-results'/digest[:16];folder.mkdir(parents=True,exist_ok=True);(folder/'case.json').write_bytes((dest/'case.json').read_bytes());save(folder.parent/'manifest.json',{'path':digest[:16]+'/case.json','sha256':digest,'run_id':p['run_id']});print('Exported',p['run_id'],flush=True)
if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[1]=='resume-score':
        dest=ROOT/'artifacts/colbert-runs'/sys.argv[2];p=load(dest/'frozen.json');parent=ROOT/'artifacts/retrieval-runs'/p['protocol']['parent_run'];score(dest,parent,load(parent/'frozen.json'),resume=True);export(dest);save(ROOT/'artifacts/colbert-latest.json',{'run_id':dest.name})
    elif len(sys.argv)>1 and sys.argv[1]=='export':export(ROOT/'artifacts/colbert-runs'/load(ROOT/'artifacts/colbert-latest.json')['run_id'])
    else:run()

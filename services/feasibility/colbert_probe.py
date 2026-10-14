"""Pinned ColBERT weight feasibility; exact uncompressed prototype, not official engine."""
import hashlib,json,platform,resource,string,sys,time
from pathlib import Path
import numpy as np
import torch
from torch.nn.functional import normalize
from transformers import BertConfig,BertModel,BertTokenizerFast
from safetensors.torch import load_file
from huggingface_hub import snapshot_download
ROOT=Path(__file__).resolve().parents[2]
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,data):path.parent.mkdir(exist_ok=True,parents=True);path.write_text(json.dumps(data,indent=2,ensure_ascii=False,allow_nan=False)+'\n')
def maxsim(q,d):return (q@d.T).max(dim=1).values.sum()
def main():
    cfg=json.loads(Path(__file__).with_name('colbert-protocol.json').read_text())
    parent=ROOT/'artifacts/retrieval-runs'/cfg['parent_run'];frozen=json.loads((parent/'frozen.json').read_text())
    for file,key in [('documents.json','documents_sha256'),('rankings.json','rankings_sha256')]:
        if sha(parent/file)!=frozen[key]:raise ValueError('Frozen parent changed')
    docs=json.loads((parent/'documents.json').read_text());queries={r['id']:r['text'] for r in json.loads((parent/'rankings.json').read_text())}
    order=lambda v:sorted(v,key=lambda x:hashlib.sha256(x.encode()).hexdigest())
    dids=order(docs)[:cfg['documents']];qids=order(queries)[:cfg['queries']]
    path=Path(snapshot_download(cfg['model'],revision=cfg['revision'],local_files_only=True))
    meta=json.loads((path/'artifact.metadata').read_text())
    for key in ['doc_maxlen','query_maxlen','dim']:
        if meta[key]!=cfg[{'dim':'dimensions'}.get(key,key)]:raise ValueError('Checkpoint config mismatch')
    torch.set_num_threads(cfg['threads']);torch.manual_seed(42)
    tokenizer=BertTokenizerFast.from_pretrained(path,local_files_only=True)
    bert=BertModel(BertConfig.from_json_file(path/'config.json'));projection=torch.nn.Linear(768,cfg['dimensions'],bias=False)
    state=load_file(path/'model.safetensors');b={k[5:]:v for k,v in state.items() if k.startswith('bert.') and k!='bert.embeddings.position_ids'}
    bert.load_state_dict(b,strict=True);projection.load_state_dict({'weight':state['linear.weight']},strict=True);del state,b
    bert.eval();projection.eval()
    skip={tokenizer.encode(c,add_special_tokens=False)[0] for c in string.punctuation}|{tokenizer.pad_token_id}
    def tensorize(texts,query=False):
        limit=cfg['query_maxlen'] if query else cfg['doc_maxlen']
        t=tokenizer(texts,padding='max_length' if query else True,truncation=True,max_length=limit-1,return_tensors='pt')
        marker=torch.full((len(texts),1),cfg['query_marker_id'] if query else cfg['document_marker_id'],dtype=torch.long)
        ids=torch.cat([t.input_ids[:,:1],marker,t.input_ids[:,1:]],dim=1)
        attention=torch.cat([t.attention_mask[:,:1],torch.ones_like(marker),t.attention_mask[:,1:]],dim=1)
        if query:ids[ids==tokenizer.pad_token_id]=tokenizer.mask_token_id
        return ids,attention
    def encode(texts,query=False):
        ids,attention=tensorize(texts,query)
        with torch.inference_mode():v=normalize(projection(bert(ids,attention_mask=attention).last_hidden_state),dim=-1)
        return [(vec if query else vec[torch.tensor([i not in skip for i in row.tolist()])]) for row,vec in zip(ids,v)],ids
    texts={k:v['title']+' '+v['text'] for k,v in docs.items()}
    # Count actual WordPiece length for the whole local corpus; no quality labels.
    tokens=tokenizer(list(texts.values()),add_special_tokens=False,truncation=False,verbose=False).input_ids
    lengths=np.array([len(x)+3 for x in tokens])
    retained=[sum(t not in skip for t in [tokenizer.cls_token_id,cfg['document_marker_id'],*x[:cfg['doc_maxlen']-3],tokenizer.sep_token_id]) for x in tokens]
    qlengths=[len(x)+3 for x in tokenizer(list(queries.values()),add_special_tokens=False,truncation=False).input_ids]
    encode([texts[d] for d in dids[:cfg['batch_size']]]);encode([queries[qids[0]]],True)
    vectors=[];start=time.perf_counter()
    for i in range(0,len(dids),cfg['batch_size']):
        batch,_=encode([texts[d] for d in dids[i:i+cfg['batch_size']]]);vectors+=batch
    corpus_seconds=time.perf_counter()-start
    costs=[];example=None
    for qid in qids:
        for repeat in range(3):
            start=time.perf_counter();qs,ids=encode([queries[qid]],True);q=qs[0];t1=time.perf_counter()
            scores=torch.stack([maxsim(q,d) for d in vectors]);t2=time.perf_counter()
            torch.stack([maxsim(q,d) for d in vectors[:50]]);t3=time.perf_counter()
            costs.append({'query':qid,'repeat':repeat,'query_ms':(t1-start)*1000,'score256_ms':(t2-t1)*1000,'score50_ms':(t3-t2)*1000})
        if example is None:
            j=int(scores.argmax());did=dids[j];dids_encoded,_=tensorize([texts[did]])
            valid=[i for i in dids_encoded[0].tolist() if i not in skip]
            sims=q@vectors[j].T;values,pos=sims.max(dim=1)
            np.testing.assert_allclose(float(values.sum()),float(scores[j]),rtol=1e-5)
            example={'query_id':qid,'document_id':did,'score':float(scores[j]),'tokens':[{'query_token':tokenizer.convert_ids_to_tokens(int(token)),'document_token':tokenizer.convert_ids_to_tokens(valid[int(p)]),'max_cosine':float(v)} for token,p,v in zip(ids[0],pos,values)],'scope':'highest score in hash-selected 256 documents; not known relevant, not full-corpus top1; specials and MASK included in sum'}
    env={'python':platform.python_version(),'torch':torch.__version__,'platform':platform.platform(),'device':'cpu','threads':torch.get_num_threads()}
    report={'schema':1,'protocol':cfg,'protocol_sha256':sha(Path(__file__).with_name('colbert-protocol.json')),'script_sha256':sha(__file__),
        'parent_hashes':{k:frozen[k] for k in ['documents_sha256','rankings_sha256']},'model_files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in path.iterdir() if f.is_file() and f.suffix in ['.json','.txt','.safetensors'] or f.name in ['artifact.metadata','README.md']},
        'environment':env,'corpus_count':len(docs),'query_count':len(queries),'sample_document_ids':dids,'sample_query_ids':qids,
        'full_corpus_wordpiece_quantiles':{str(k):float(np.quantile(lengths,k)) for k in [.5,.9,.95,1]},
        'documents_truncated_at':{str(k):int((lengths>k).sum()) for k in [180,256,512]},'queries_truncated_at_32':sum(n>32 for n in qlengths),
        'uncompressed_full_corpus_vector_bytes':{'float32':int(sum(retained)*128*4),'float16':int(sum(retained)*128*2)},
        'existing_dense_vector_file_bytes':frozen['costs']['bytes']['vectors.npy'],
        'sample_encoding_seconds':corpus_seconds,'linear_full_corpus_seconds_estimate':corpus_seconds*len(docs)/len(dids),
        'peak_process_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024),
        'timing_summary_ms':{key:{'median':float(np.median([r[key] for r in costs])),'p95':float(np.quantile([r[key] for r in costs],.95))} for key in ['query_ms','score256_ms','score50_ms']},
        'observations':costs,'quality_metrics':None,'official_engine_parity':False,'sample_matches':example}
    save(ROOT/'artifacts/feasibility/colbert-probe-v1.json',report)
    summary={k:v for k,v in report.items() if k not in ['sample_document_ids','sample_query_ids','observations','sample_matches']}
    save(ROOT/'docs/evaluation/colbert-feasibility-v1.json',summary)
    print(json.dumps({k:summary[k] for k in ['documents_truncated_at','uncompressed_full_corpus_vector_bytes','sample_encoding_seconds','timing_summary_ms','peak_process_rss_bytes']},indent=2))
if __name__=='__main__':main()

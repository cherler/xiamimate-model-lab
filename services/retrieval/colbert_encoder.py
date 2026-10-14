"""Uncompressed CPU encoder and checks against pinned official core routines."""
import ast,json,string,types
from pathlib import Path
import numpy as np
import torch
from transformers import BertConfig,BertModel,BertTokenizerFast
from safetensors.torch import load_file
from huggingface_hub import snapshot_download
from .run import sha
ROOT=Path(__file__).resolve().parents[2]
class Encoder:
    def __init__(self,cfg):
        self.cfg=cfg;self.path=Path(snapshot_download(cfg['model'],revision=cfg['revision'],local_files_only=True))
        self.tok=BertTokenizerFast.from_pretrained(self.path,local_files_only=True)
        self.bert=BertModel(BertConfig.from_json_file(self.path/'config.json')).eval();self.linear=torch.nn.Linear(768,128,bias=False).eval()
        state=load_file(self.path/'model.safetensors')
        self.bert.load_state_dict({k[5:]:v for k,v in state.items() if k.startswith('bert.') and k!='bert.embeddings.position_ids'},strict=True)
        self.linear.load_state_dict({'weight':state['linear.weight']},strict=True)
        self.skip={self.tok.encode(c,add_special_tokens=False)[0] for c in string.punctuation}|{self.tok.pad_token_id}
    def tensorize(self,texts,query=False):
        limit=self.cfg['query_maxlen'] if query else self.cfg['doc_maxlen']
        t=self.tok(texts,padding='max_length' if query else True,truncation=True,max_length=limit-1,return_tensors='pt')
        marker=torch.full((len(texts),1),1 if query else 2,dtype=torch.long)
        ids=torch.cat([t.input_ids[:,:1],marker,t.input_ids[:,1:]],dim=1)
        mask=torch.cat([t.attention_mask[:,:1],torch.ones_like(marker),t.attention_mask[:,1:]],dim=1)
        if query:ids[ids==self.tok.pad_token_id]=self.tok.mask_token_id
        return ids,mask
    def encode(self,texts,query=False):
        ids,mask=self.tensorize(texts,query)
        with torch.inference_mode():v=torch.nn.functional.normalize(self.linear(self.bert(ids,attention_mask=mask).last_hidden_state),dim=-1)
        vectors=[];tokenids=[]
        for row,vec in zip(ids,v):
            keep=torch.ones(len(row),dtype=torch.bool) if query else torch.tensor([i not in self.skip for i in row.tolist()])
            vectors.append(vec[keep]);tokenids.append(row[keep].tolist())
        return vectors,tokenids

def chunks(text,tok,size=160,stride=128):
    offsets=tok(text,add_special_tokens=False,return_offsets_mapping=True,truncation=False,verbose=False).offset_mapping
    if not offsets:return [{'start':0,'end':len(text),'text':text}]
    result=[];i=0
    while i<len(offsets):
        j=min(len(offsets),i+size);start=offsets[i][0];end=offsets[j-1][1]
        while len(tok(text[start:end],add_special_tokens=False).input_ids)>size and j>i+1:
            j-=1;end=offsets[j-1][1]
        result.append({'start':start,'end':end,'text':text[start:end]})
        if j==len(offsets):break
        i=min(i+stride,j)
    # Assert every token span is covered by at least one chunk; whitespace has no scoring token.
    if any(not any(r['start']<=a and b<=r['end'] for r in result) for a,b in offsets):raise ValueError('Chunk coverage gap')
    return result

def query_prefix(text,tok,limit):
    offsets=tok(text,add_special_tokens=False,return_offsets_mapping=True).offset_mapping
    end=offsets[min(len(offsets),limit)-1][1] if offsets else len(text)
    value=text[:end]
    while len(tok(value,add_special_tokens=False).input_ids)>limit:value=value[:-1]
    return value

def reference_parity(enc):
    manifest=json.loads((ROOT/'services/retrieval/colbert-reference.json').read_text());folder=ROOT/'artifacts/colbert-reference'/manifest['revision']
    for file,digest in manifest['files'].items():
        if sha((folder/file).read_bytes())!=digest:raise ValueError('Official reference changed')
    cfg=types.SimpleNamespace(checkpoint=str(enc.path),query_maxlen=enc.cfg['query_maxlen'],doc_maxlen=enc.cfg['doc_maxlen'],query_token='[Q]',query_token_id='[unused0]',doc_token='[D]',doc_token_id='[unused1]',attend_to_mask_tokens=False,interaction='colbert')
    ns={'torch':torch,'ColBERTConfig':types.SimpleNamespace,'DEVICE':'cpu','class_factory':lambda _:types.SimpleNamespace(raw_tokenizer_from_pretrained=lambda _:enc.tok)}
    def extract(file,names):
        tree=ast.parse((folder/file).read_text());nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
        if len(nodes)!=len(names):raise ValueError('Reference routines missing')
        exec(compile(ast.Module(body=nodes,type_ignores=[]),file,'exec'),ns)
    extract('colbert/modeling/tokenization/utils.py',['_insert_prefix_token'])
    extract('colbert/modeling/tokenization/query_tokenization.py',['QueryTokenizer'])
    extract('colbert/modeling/tokenization/doc_tokenization.py',['DocTokenizer'])
    extract('colbert/modeling/colbert.py',['colbert_score_reduce'])
    # Extract official model methods without its optional compiled index imports.
    cls=next(n for n in ast.parse((folder/'colbert/modeling/colbert.py').read_text()).body if isinstance(n,ast.ClassDef) and n.name=='ColBERT')
    methods=[n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name in ['query','doc','mask']]
    exec(compile(ast.Module(body=methods,type_ignores=[]),'official_colbert_core','exec'),ns)
    ref=types.SimpleNamespace(bert=enc.bert,linear=enc.linear,device='cpu',pad_token=enc.tok.pad_token_id,skiplist=enc.skip,use_gpu=False)
    ref.mask=types.MethodType(ns['mask'],ref)
    query=ns['QueryTokenizer'](cfg,verbose=0);document=ns['DocTokenizer'](cfg)
    texts=['Heart disease treatment.','No increase in risk?', 'immune response '*100,'']
    errors=[]
    for isq,tokenizer,fn in [(True,query,ns['query']),(False,document,ns['doc'])]:
        a,b=tokenizer.tensorize(texts);x,y=enc.tensorize(texts,isq);torch.testing.assert_close(a,x,rtol=0,atol=0);torch.testing.assert_close(b,y,rtol=0,atol=0)
        with torch.inference_mode():refv=fn(ref,a,b)
        local,ids=enc.encode(texts,isq)
        for i,v in enumerate(local):
            keep=torch.ones(len(a[i]),dtype=torch.bool) if isq else torch.tensor([t not in enc.skip for t in a[i].tolist()])
            delta=float((v-refv[i][keep]).abs().max());errors.append(delta);torch.testing.assert_close(v,refv[i][keep],rtol=1e-5,atol=1e-6)
    q,_=enc.encode(texts,True);d,_=enc.encode(texts)
    score_errors=[]
    for a in q:
        for b in d:
            local=(a@b.T).max(dim=1).values.sum();official=ns['colbert_score_reduce']((b@a.T).unsqueeze(0),torch.ones((1,len(b)),dtype=torch.bool),cfg)[0]
            score_errors.append(abs(float(local-official)));torch.testing.assert_close(local,official,rtol=1e-5,atol=1e-5)
    return {'passed':True,'reference':manifest,'text_cases':len(texts),'pair_cases':len(score_errors),'max_embedding_error':max(errors),'max_score_error':max(score_errors),'scope':'official tokenization/encoding/mask/MaxSim core routines; same loaded weights; no PLAID/quantization/index verification'}

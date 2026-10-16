"""Audit existing evidence before E10 inference; only already-scored labels used."""
from pathlib import Path
from transformers import BertTokenizerFast
from huggingface_hub import snapshot_download
from .run import ROOT, load, save, sha
from .colbert_encoder import chunks, query_prefix
CONFIG = Path(__file__).with_name('cost-protocol.json')
AUDIT = ROOT/'docs/evaluation/retrieval-cost-audit-v1.json'


def audit():
    cfg=load(CONFIG); parent=ROOT/'artifacts/retrieval-runs'/cfg['parent_run']; colbert=ROOT/'artifacts/colbert-runs'/cfg['colbert_run']
    p=load(parent/'case.json'); c=load(colbert/'case.json'); frozen=load(parent/'frozen.json')
    if sha((parent/'documents.json').read_bytes())!=frozen['documents_sha256'] or sha((parent/'case.json').read_bytes())!=c['parent_sha256']:
        raise ValueError('Existing evidence source mismatch')
    if sha((colbert/'frozen.json').read_bytes())!=c['frozen_sha256']:
        raise ValueError('Frozen ColBERT evidence changed')
    tok=BertTokenizerFast.from_pretrained(snapshot_download(c['protocol']['model'],revision=c['protocol']['revision'],local_files_only=True),local_files_only=True)
    documents=[]
    for did,d in sorted(p['documents'].items()):
        text=d['title']+' '+d['text']; n=len(tok(text,add_special_tokens=False,truncation=False,verbose=False).input_ids)
        parts=chunks(text,tok,160,128)
        documents.append({'id':did,'wordpieces':n,'chunks':len(parts),'dense_truncated':n>254,'first_chunk_truncated':len(parts)>1})
    queries=[]
    for q in p['queries']:
        targets=list(q['relevant']); candidates=q['rankings']['hybrid']
        queries.append({'id':q['id'],'targets':len(targets),'outside50':[d for d in targets if d not in candidates[:50]],
            'outside100':[d for d in targets if d not in candidates],
            'query_truncated':query_prefix(q['text'],tok,61)!=q['text']})
    result={'version':cfg['version'],'protocol_sha256':sha(CONFIG.read_bytes()),'auditor_sha256':sha(Path(__file__).read_bytes()),
        'parent_sha256':sha((parent/'case.json').read_bytes()),'colbert_sha256':sha((colbert/'case.json').read_bytes()),
        'documents':documents,'queries':queries,
        'summary':{'documents':len(documents),'queries':len(queries),'chunks':sum(d['chunks'] for d in documents),
            'dense_truncated_documents':sum(d['dense_truncated'] for d in documents),
            'multichunk_documents':sum(d['first_chunk_truncated'] for d in documents),
            'query_truncated':sum(q['query_truncated'] for q in queries),
            'queries_missing50':sum(bool(q['outside50']) for q in queries),'targets_missing50':sum(len(q['outside50']) for q in queries),
            'queries_missing100':sum(bool(q['outside100']) for q in queries),'targets_missing100':sum(len(q['outside100']) for q in queries),
            'old_index_documents':c['costs']['candidate_documents']},
        'existing_costs':{'base':p['report']['costs'],'colbert':c['costs']},
        'experiment_reason':'Existing reranking cannot recover outside50 targets; old costs omit candidate retrieval and544 corpus documents. Need fixed full-corpus scan versus50/100 same-model candidates, and measured per-query complete pipeline costs.',
        'unmeasured':['network/API/concurrency','document update cost','compressed ANN/PLAID index','new-domain performance','human time saved or financial returns']}
    return result


if __name__=='__main__':
    result=audit()
    if AUDIT.exists() and load(AUDIT)!=result:raise ValueError('Frozen audit changed; version the protocol')
    save(AUDIT,result);print(result['summary'])

"""Frozen SciFact benchmark. Rank without relevance values, then score saved rankings."""
import argparse
import csv
import hashlib
import io
import json
import platform
import resource
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from scipy import sparse
from .core import BM25, METHODS, fuse, metrics, ordered, rerank_with_tail

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'services/retrieval/protocol.json'
ARTIFACTS = ROOT / 'artifacts/retrieval-runs'
LATEST = ROOT / 'artifacts/retrieval-latest.json'
PUBLIC = ROOT / 'apps/web/retrieval-results'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def load(path):
    return json.loads(path.read_text())


def now():
    return datetime.now(timezone.utc).isoformat()


def prepare():
    import urllib.request
    from huggingface_hub import snapshot_download
    cfg = load(CONFIG)
    archive = ROOT / 'data/raw/retrieval/scifact.zip'
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        temporary = archive.with_suffix('.download')
        urllib.request.urlretrieve(cfg['download'], temporary)
        if sha(temporary.read_bytes()) != cfg['zip_sha256']:
            raise ValueError('Downloaded ZIP hash mismatch; retained for inspection')
        temporary.replace(archive)
    if sha(archive.read_bytes()) != cfg['zip_sha256']:
        raise ValueError('Existing ZIP hash mismatch')
    for key in ['dense', 'reranker']:
        model = cfg[key]
        snapshot_download(model['model'], revision=model['revision'],
                          allow_patterns=['*.json', '*.txt', '*.safetensors', 'README.md', 'LICENSE*'])
    print('Pinned data and model snapshots ready', flush=True)


def rank():
    import torch
    import transformers
    import sentence_transformers
    from huggingface_hub import snapshot_download
    from sentence_transformers import SentenceTransformer, CrossEncoder
    cfg = load(CONFIG)
    archive = ROOT / 'data/raw/retrieval/scifact.zip'
    if sha(archive.read_bytes()) != cfg['zip_sha256']:
        raise ValueError('Dataset ZIP hash mismatch')
    run_id = 'scifact-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    dest = ARTIFACTS / run_id
    dest.mkdir(parents=True, exist_ok=False)
    blobs = {}
    with zipfile.ZipFile(archive) as z:
        for name in ['corpus.jsonl', 'queries.jsonl', 'qrels/test.tsv']:
            blobs[name] = z.read('scifact/' + name)
    docs = sorted((json.loads(line) for line in blobs['corpus.jsonl'].splitlines()), key=lambda d: d['_id'])
    queries = {q['_id']: q['text'] for q in map(json.loads, blobs['queries.jsonl'].splitlines())}
    # Select only query identifiers. Relevance values are not parsed until score().
    query_ids = sorted({line.split(b'\t', 1)[0].decode() for line in blobs['qrels/test.tsv'].splitlines()[1:]})
    if len(docs) != 5183 or len(query_ids) != 300:
        raise ValueError('Unexpected benchmark scope')
    document_ids = [d['_id'] for d in docs]
    texts = [d['title'] + ' ' + d['text'] for d in docs]
    text_by_id = dict(zip(document_ids, texts))
    save(dest / 'protocol.json', cfg)
    source_hashes = {name: sha(value) for name, value in blobs.items()}
    for name in ['core.py', 'run.py']:
        (dest / name).write_bytes((Path(__file__).parent / name).read_bytes())
    del blobs
    torch.set_num_threads(4)
    torch.manual_seed(cfg['seed'])
    np.random.seed(cfg['seed'])
    model_paths, model_files = {}, {}
    for key in ['dense', 'reranker']:
        m = cfg[key]
        path = Path(snapshot_download(m['model'], revision=m['revision'], local_files_only=True))
        model_paths[key] = path
        model_files[key] = {str(f.relative_to(path)): {'sha256': sha(f.read_bytes()), 'bytes': f.stat().st_size}
                            for f in sorted(path.rglob('*')) if f.is_file()}
    dense = SentenceTransformer(str(model_paths['dense']), device='cpu', trust_remote_code=False, local_files_only=True)
    dense.max_seq_length = cfg['dense']['max_length']
    cross = CrossEncoder(str(model_paths['reranker']), device='cpu', max_length=cfg['reranker']['max_length'],
                         activation_fn=torch.nn.Identity(), trust_remote_code=False, local_files_only=True)
    started = time.perf_counter()
    bm = BM25(texts, **{k: cfg['bm25'][k] for k in ['k1', 'b']})
    sparse.save_npz(dest / 'bm25.npz', bm.matrix)
    save(dest / 'vocabulary.json', bm.vocab)
    sparse_seconds = time.perf_counter() - started
    dense.encode(['A short scientific document.'], normalize_embeddings=True, show_progress_bar=False)
    cross.predict([('A scientific claim.', 'A scientific abstract.')], show_progress_bar=False)
    started = time.perf_counter()
    vectors = dense.encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=True).astype(np.float32)
    np.save(dest / 'vectors.npy', vectors)
    dense_seconds = time.perf_counter() - started
    predictions = []
    print(f'{run_id}: indexes built; ranking {len(query_ids)} queries without relevance scores', flush=True)
    for i, qid in enumerate(query_ids):
        q = queries[qid]
        t = time.perf_counter(); a = ordered(document_ids, bm.score(q)); t1 = time.perf_counter()
        v = dense.encode([q], normalize_embeddings=True, show_progress_bar=False)[0]
        b = ordered(document_ids, vectors @ v); t2 = time.perf_counter()
        h = fuse(a, b); t3 = time.perf_counter()
        scores = cross.predict([(q, text_by_id[d]) for d, _ in h[:50]], batch_size=32, show_progress_bar=False)
        r = rerank_with_tail(h, np.asarray(scores).reshape(-1)); t4 = time.perf_counter()
        predictions.append({'id': qid, 'text': q, 'rankings': {m: [d for d, _ in result] for m, result in zip(METHODS, [a, b, h, r])},
                            'milliseconds': dict(zip(METHODS, [1000*(t1-t), 1000*(t2-t1), 1000*(t3-t), 1000*(t4-t)])),
                            'components_ms': {'bm25': 1000*(t1-t), 'dense': 1000*(t2-t1), 'fusion': 1000*(t3-t2), 'cross_encoder': 1000*(t4-t3)}})
        if (i + 1) % 25 == 0:
            print(f'Ranked {i+1}/300', flush=True)
    save(dest / 'rankings.json', predictions)
    save(dest / 'documents.json', {d['_id']: {'title': d['title'], 'text': d['text']} for d in docs})
    report = {'run_id': run_id, 'rankings_frozen_at': now(), 'rankings_sha256': sha((dest / 'rankings.json').read_bytes()),
              'documents_sha256': sha((dest / 'documents.json').read_bytes()), 'source_hashes': source_hashes,
              'protocol_sha256': sha((dest / 'protocol.json').read_bytes()), 'protocol': cfg, 'document_count': len(docs), 'query_count': len(query_ids),
              'environment': {'python': platform.python_version(), 'torch': torch.__version__, 'transformers': transformers.__version__,
                              'sentence_transformers': sentence_transformers.__version__, 'platform': platform.platform(), 'processor': platform.processor(), 'threads': torch.get_num_threads()},
              'model_files': model_files,
              'costs': {'sparse_build_seconds': sparse_seconds, 'dense_build_seconds': dense_seconds, 'vocabulary_terms': len(bm.vocab),
                        'bytes': {name: (dest / name).stat().st_size for name in ['bm25.npz', 'vocabulary.json', 'vectors.npy', 'documents.json']},
                        'model_bytes': {key: sum(f['bytes'] for f in files.values()) for key, files in model_files.items()},
                        'peak_rss_bytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024)}}
    save(dest / 'frozen.json', report)
    save(LATEST, {'run_id': run_id})
    print('Rankings frozen: ' + str(dest), flush=True)


def score():
    dest = ARTIFACTS / load(LATEST)['run_id']
    r = load(dest / 'frozen.json')
    for name, key in [('rankings.json', 'rankings_sha256'), ('documents.json', 'documents_sha256'), ('protocol.json', 'protocol_sha256')]:
        if sha((dest / name).read_bytes()) != r[key]:
            raise ValueError('Frozen artifact changed: ' + name)
    ledger = dest / 'label-access.json'
    # Exclusive record persists on error; never silently reopen as a fresh benchmark.
    with ledger.open('x') as f:
        json.dump({'opened_at': now(), 'status': 'opened', 'rankings_sha256': r['rankings_sha256']}, f)
    with zipfile.ZipFile(ROOT / 'data/raw/retrieval/scifact.zip') as z:
        labels = z.read('scifact/qrels/test.tsv')
    if sha(labels) != r['source_hashes']['qrels/test.tsv']:
        raise ValueError('Qrels hash mismatch')
    relevant = {}
    for row in csv.DictReader(io.StringIO(labels.decode()), delimiter='\t'):
        if int(row['score']) > 0:
            relevant.setdefault(row['query-id'], {})[row['corpus-id']] = int(row['score'])
    rows = load(dest / 'rankings.json')
    for q in rows:
        q['relevant'] = relevant[q['id']]
        q['metrics'] = {m: metrics(q['rankings'][m], q['relevant']) for m in METHODS}
    r['summary'] = {m: {key: float(np.mean([q['metrics'][m][key] for q in rows])) for key in r['protocol']['metrics']} for m in METHODS}
    r['timing_ms'] = {m: {'p50': float(np.percentile([q['milliseconds'][m] for q in rows], 50)),
                            'p95': float(np.percentile([q['milliseconds'][m] for q in rows], 95))} for m in METHODS}
    access = {**load(ledger), 'completed_at': now(), 'status': 'completed', 'scope': 'known public benchmark; no fine-tuning'}
    r['label_access'] = access
    save(dest / 'case.json', {'run_id': r['run_id'], 'report': r, 'queries': rows, 'documents': load(dest / 'documents.json')})
    save(ledger, access)
    print(json.dumps(r['summary'], indent=2), flush=True)


NOTICE = '''SciFact retrieval benchmark adaptation — data export license CC BY-SA 4.0
https://creativecommons.org/licenses/by-sa/4.0/
SciFact: Wadden, Lin, Lo, Wang, van Zuylen, Cohan and Hajishirzi (2020), Fact or Fiction: Verifying Scientific Claims.
https://github.com/allenai/scifact — claims and evidence annotations CC BY 4.0.
https://github.com/allenai/scifact/blob/master/LICENSE.md
Corpus abstracts: Lo et al. (2020), S2ORC: The Semantic Scholar Open Research Corpus; ODC-By 1.0.
https://opendatacommons.org/licenses/by/1-0/
BEIR adaptation: Thakur et al. (2021), BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models.
https://huggingface.co/datasets/BeIR/scifact — CC BY-SA 4.0 per dataset card.
This project adds rankings, timings, metrics and a replay UI; preserves English titles, abstracts and claims.
Relevance is not verification of a scientific claim; unjudged documents are not necessarily irrelevant.
Known public benchmark, not a new independent holdout. Pretraining overlap cannot be excluded. No local fine-tuning.
Pretrained models (not redistributed): sentence-transformers/all-MiniLM-L6-v2 and cross-encoder/ms-marco-MiniLM-L6-v2, Apache-2.0.
Application source and other datasets are separate from this data adaptation.
'''


def export():
    dest = ARTIFACTS / load(LATEST)['run_id']
    payload = load(dest / 'case.json')
    if load(dest / 'label-access.json')['status'] != 'completed':
        raise ValueError('Incomplete label access')
    r = payload['report']
    original = load(dest / 'rankings.json')
    for name, key in [('rankings.json', 'rankings_sha256'), ('documents.json', 'documents_sha256'), ('protocol.json', 'protocol_sha256')]:
        if sha((dest / name).read_bytes()) != r[key]:
            raise ValueError('Frozen artifact hash changed: ' + name)
    if payload['documents'] != load(dest / 'documents.json') or len(original) != len(payload['queries']):
        raise ValueError('Export scope changed')
    for old, q in zip(original, payload['queries']):
        if any(q[key] != value for key, value in old.items()):
            raise ValueError('Saved rankings or timings changed')
        for m in METHODS:
            if q['metrics'][m] != metrics(q['rankings'][m], q['relevant']):
                raise ValueError('Metrics cannot be reproduced')
        hybrid, reranked = q['rankings']['hybrid'], q['rankings']['rerank']
        if set(hybrid[:50]) != set(reranked[:50]) or hybrid[50:] != reranked[50:]:
            raise ValueError('Reranker candidate boundary changed')
    for m in METHODS:
        for key in r['protocol']['metrics']:
            if abs(r['summary'][m][key] - np.mean([q['metrics'][m][key] for q in payload['queries']])) > 1e-12:
                raise ValueError('Aggregate metric mismatch')
    payload['notice'] = NOTICE
    data = (json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()
    digest = sha(data)
    folder = PUBLIC / digest[:16]
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'case.json').write_bytes(data)
    (folder / 'NOTICE.txt').write_text(NOTICE)
    save(PUBLIC / 'manifest.json', {'run_id': payload['run_id'], 'path': digest[:16] + '/case.json', 'sha256': digest,
                                   'notice': digest[:16] + '/NOTICE.txt', 'notice_sha256': sha(NOTICE.encode())})
    print('Exported ' + str(folder), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'rank', 'score', 'export'])
    globals()[parser.parse_args().command]()

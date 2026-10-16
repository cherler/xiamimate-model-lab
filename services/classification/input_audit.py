"""E9 reads only the three existing development partitions, never the raw archive."""
from pathlib import Path
import numpy as np
from .run import ROOT, read, write, digest, partition

PROTOCOL = Path(__file__).with_name('input_protocol.json')
AUDIT = ROOT / 'docs/evaluation/classification-input-audit-v1.json'
ALLOWED = ('train', 'calibration', 'validation')


def load_development(name, directory, meta):
    if name not in ALLOWED:
        raise ValueError('E9 only permits existing development partitions')
    return partition(directory, meta, name)


def columns(features, cfg, variant):
    return [i for i, f in enumerate(features) if any(f.startswith(cfg['groups'][g]) for g in cfg['variants'][variant])]


def audit():
    cfg = read(PROTOCOL)
    directory = ROOT / 'artifacts/classification-runs' / cfg['parent_run']
    meta = read(directory / 'metadata.json')
    if meta['run_id'] != cfg['parent_run'] or cfg['allowed_partitions'] != list(ALLOWED):
        raise ValueError('Unexpected parent or development scope')
    parts = {k: load_development(k, directory, meta) for k in ALLOWED}
    seen = set()
    for part in parts.values():
        groups = set(part['groups'])
        if seen & groups:
            raise ValueError('Original feature groups cross partitions')
        seen |= groups
    groups = {g: [f for f in meta['features'] if f.startswith(prefix)] for g, prefix in cfg['groups'].items()}
    if sorted(sum(groups.values(), [])) != sorted(meta['features']):
        raise ValueError('Feature groups must cover each retained input exactly once')
    variants = {}
    for variant in cfg['variants']:
        idx = columns(meta['features'], cfg, variant)
        hashes = {k: [digest(np.asarray(row[idx], dtype='<f8').tobytes()) for row in p['x']] for k, p in parts.items()}
        variants[variant] = {'features': [meta['features'][i] for i in idx],
            'validation_rows_matching_reduced_train_input': sum(h in set(hashes['train']) for h in hashes['validation'])}
    return {'version': cfg['version'], 'parent_run': cfg['parent_run'], 'protocol_sha256': digest(PROTOCOL.read_bytes()),
        'auditor_sha256': digest(Path(__file__).read_bytes()), 'metadata_sha256': digest((directory/'metadata.json').read_bytes()),
        'partitions': {k: {'rows': len(p['y']), 'groups': len(set(p['groups'])), 'positives': int(p['y'].sum()),
            'sha256': meta['partition_hashes'][k]} for k, p in parts.items()},
        'groups': groups, 'variants': variants,
        'evidence_gap': 'Individual score contributions and tree gain do not establish incremental value of input groups. Ten fixed-budget fits can answer the conditional input-value question on known development data.',
        'excluded': ['test.npz', 'test-rows.json', 'report.json', 'raw archive'],
        'unavailable': ['original email text', 'sender identity', 'time', 'new mailbox', 'measured collection or maintenance cost'],
        'scope': cfg['scope']}


if __name__ == '__main__':
    result = audit()
    if AUDIT.exists() and read(AUDIT) != result:
        raise ValueError('Frozen audit changed; create a new protocol version')
    write(AUDIT, result)
    print({k: v['rows'] for k, v in result['partitions'].items()})

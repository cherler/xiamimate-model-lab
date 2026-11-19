"""Package and restore only the already published display evidence for Pages."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'deploy/pages-evidence.json'
FOLDERS = {
    'advanced-results', 'anomaly-cross-results', 'anticheat-results',
    'classification-explanations', 'classification-input-results',
    'classification-results', 'colbert-results', 'decision-results',
    'decision-service-results', 'dressipi-results', 'm5-results',
    'monitoring-results', 'preference-results', 'retrieval-cost-results',
    'retrieval-results', 'segment-choice-results', 'selection-results',
    'showcase', 'tuning-results', 'uci-adoption-results',
    'uci-reliability-results', 'uci-results', 'uplift-results',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def valid_path(name):
    path = PurePosixPath(name)
    return (str(path) == name and not path.is_absolute()
            and '..' not in path.parts and len(path.parts) >= 2
            and path.parts[0] in FOLDERS
            and path.suffix in {'.json', '.txt', '.gz'})


def pack(archive, tag):
    if not tag or archive.exists():
        raise ValueError('Provide a release tag and a new archive path')
    records = {}
    for folder in sorted(FOLDERS):
        source = ROOT / 'dist' / folder
        if not (source / 'manifest.json').is_file():
            raise ValueError(f'Missing verified display bundle: {folder}')
        for path in sorted(source.rglob('*')):
            if path.is_symlink():
                raise ValueError('Display bundles cannot contain symlinks')
            if not path.is_file():
                continue
            name = path.relative_to(ROOT / 'dist').as_posix()
            if not valid_path(name):
                raise ValueError(f'Unexpected display resource: {name}')
            data = path.read_bytes()
            records[name] = {'sha256': digest(data), 'bytes': len(data)}
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open('wb') as output, gzip.GzipFile(fileobj=output, mode='wb', mtime=0, filename='') as zipped:
        with tarfile.open(fileobj=zipped, mode='w') as tar:
            for name in records:
                data = (ROOT / 'dist' / name).read_bytes()
                info = tarfile.TarInfo(name)
                info.size, info.mode, info.mtime = len(data), 0o644, 0
                tar.addfile(info, io.BytesIO(data))
    spec = {'schema': 1, 'tag': tag, 'asset': archive.name,
            'sha256': digest(archive.read_bytes()), 'bytes': archive.stat().st_size,
            'files': records}
    LOCK.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n')
    print(f'Packaged {len(records)} display files; {archive.stat().st_size} bytes')


def restore(archive, root=ROOT, lock=LOCK):
    root = root.resolve()
    spec = json.loads(lock.read_text())
    if spec.get('schema') != 1 or not spec.get('files'):
        raise ValueError('Invalid display evidence lock')
    if archive.stat().st_size != spec['bytes'] or digest(archive.read_bytes()) != spec['sha256']:
        raise ValueError('Display archive checksum mismatch')
    if any(not valid_path(name) for name in spec['files']):
        raise ValueError('Invalid display evidence path')
    if sum(v['bytes'] for v in spec['files'].values()) > 500_000_000:
        raise ValueError('Display evidence exceeds size limit')
    checked = {}
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            record = spec['files'].get(member.name)
            if not member.isfile() or record is None or member.name in checked or member.size != record['bytes']:
                raise ValueError('Unexpected archive entry')
            data = tar.extractfile(member).read()
            if digest(data) != record['sha256']:
                raise ValueError('Display resource checksum mismatch')
            destination = root / 'apps/web' / member.name
            if any(p.is_symlink() for p in [destination, *destination.parents]):
                raise ValueError('Cannot restore through a symlink')
            if destination.exists() and destination.read_bytes() != data:
                raise ValueError(f'Existing evidence differs; use a clean checkout: {member.name}')
            checked[member.name] = data
    if set(checked) != set(spec['files']):
        raise ValueError('Incomplete display archive')
    for name, data in checked.items():
        destination = root / 'apps/web' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    print(f'Restored {len(checked)} checksum-verified display files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['pack', 'restore'])
    parser.add_argument('archive', type=Path)
    parser.add_argument('--tag')
    args = parser.parse_args()
    if args.mode == 'pack':
        pack(args.archive, args.tag)
    else:
        restore(args.archive)

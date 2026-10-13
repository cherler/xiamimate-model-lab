"""Pinned data import; deliberately never extracts private-test sales."""
import hashlib
import json
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data/raw/m5'
SOURCES = Path(__file__).with_name('sources.json')
META = ['id', 'item_id', 'dept_id', 'cat_id', 'store_id', 'state_id']
ARCHIVE_SIZE = 50219189
ARCHIVE_GIT_BLOB = '925e92ee03cdb83c54a1dbbc12260a3b1939753c'
FILES = ['calendar.csv', 'sell_prices.csv', 'sales_train_evaluation.csv']


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n')


def prepare():
    RAW.mkdir(parents=True, exist_ok=True)
    archive = RAW / 'm5.zip'
    if not archive.exists() or archive.stat().st_size != ARCHIVE_SIZE:
        url = json.loads(SOURCES.read_text())['m5']['data_mirror']
        # Bounded chunks avoid losing the entire download to a long connection timeout.
        parts = RAW / 'download-parts'
        parts.mkdir(exist_ok=True)
        size = 2 * 1024 * 1024

        def fetch(start):
            stop = min(start + size, ARCHIVE_SIZE) - 1
            path = parts / str(start)
            if path.exists() and path.stat().st_size == stop - start + 1:
                return path
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={'Range': f'bytes={start}-{stop}'})
                    with urllib.request.urlopen(req, timeout=60) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{stop}/{ARCHIVE_SIZE}':
                            raise ValueError('server did not honor exact byte range')
                        content = response.read()
                    if len(content) != stop - start + 1:
                        raise ValueError('incomplete download chunk')
                    path.write_bytes(content)
                    print(f'downloaded M5 bytes {start}-{stop}', flush=True)
                    return path
                except Exception:
                    if attempt == 2:
                        raise
        with ThreadPoolExecutor(max_workers=4) as pool:
            downloaded = list(pool.map(fetch, range(0, ARCHIVE_SIZE, size)))
        with archive.open('wb') as out:
            for path in downloaded:
                out.write(path.read_bytes())
    content = archive.read_bytes()
    git_hash = hashlib.sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
    if git_hash != ARCHIVE_GIT_BLOB:
        raise ValueError('archive differs from pinned GitHub blob; refusing import')
    with zipfile.ZipFile(archive) as z:
        for name in FILES:
            matches = [p for p in z.namelist() if Path(p).name == name and not p.startswith('__MACOSX/')]
            if len(matches) != 1:
                raise ValueError(f'expected exactly one {name}')
            # Whitelist names, no generic extraction or executable/archive paths.
            (RAW / name).write_bytes(z.read(matches[0]))
    manifest = {'source': json.loads(SOURCES.read_text())['m5'],
                'archive_sha256': digest(archive), 'archive_git_blob': git_hash,
                'files': {name: digest(RAW / name) for name in FILES},
                'private_test_extracted': False}
    write(RAW / 'manifest.json', manifest)
    return manifest


def load(store, max_day):
    if not 1 <= max_day <= 1941:
        raise ValueError('private competition test is not available to this loader')
    # Column whitelist avoids materializing labels beyond the authorized origin.
    days = [f'd_{d}' for d in range(1, max_day + 1)]
    # Organizer-style mirror omits Kaggle's redundant id column; reconstruct it.
    chunks = pd.read_csv(RAW / 'sales_train_evaluation.csv', usecols=META[1:] + days,
                         dtype={d: 'float32' for d in days}, chunksize=4096)
    selected = [chunk.loc[chunk.store_id.eq(store)] for chunk in chunks]
    sales = pd.concat(selected, ignore_index=True).sort_values('item_id').reset_index(drop=True)
    sales['id'] = sales.item_id.astype(str) + '_' + sales.store_id.astype(str)
    if sales.empty or sales.duplicated(['store_id', 'item_id']).any():
        raise ValueError('missing or duplicate series')
    calendar = pd.read_csv(RAW / 'calendar.csv')
    calendar['day'] = calendar.d.str.removeprefix('d_').astype(int)
    calendar = calendar.sort_values('day').reset_index(drop=True)
    if calendar.day.tolist() != list(range(1, len(calendar) + 1)):
        raise ValueError('calendar day gaps')
    prices = pd.read_csv(RAW / 'sell_prices.csv')
    prices = prices.loc[prices.store_id.eq(store)]
    if prices.duplicated(['item_id', 'wm_yr_wk']).any():
        raise ValueError('duplicate weekly prices')
    wide = prices.pivot(index='item_id', columns='wm_yr_wk', values='sell_price')
    price_matrix = wide.reindex(index=sales.item_id, columns=calendar.wm_yr_wk).to_numpy(dtype='float32')
    return sales[META], sales[days].to_numpy(dtype='float32'), calendar, price_matrix


def revenue_at(history, prices, origin):
    units = history[:, origin - 28:origin]
    price = prices[:, origin - 28:origin]
    if ((units > 0) & (~np.isfinite(price) | (price <= 0))).any():
        raise ValueError('sales-dollar weight cannot be computed for sold items without price')
    return np.nansum(units * price, axis=1, dtype='float64')


if __name__ == '__main__':
    print(json.dumps(prepare(), indent=2))

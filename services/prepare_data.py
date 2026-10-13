"""Acquire public UCI data with explicit provenance, audit it, cache normalized sales."""
from pathlib import Path
import hashlib
import json
import shutil
import urllib.request
import zipfile
import zlib
import pandas as pd
from ml.core import clean_transactions

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://archive.ics.uci.edu/static/public/502/online%2Bretail%2Bii.zip'
MIRROR = 'https://api.github.com/repos/bonifasiusx/lrfm-analysis-online-retail-store/contents/online_retail_II.xlsx'
# GitHub ETag and independently published HuggingFace LFS SHA-256 for the same XLSX.
MIRROR_ETAG = '47b49d0acea9a5b1895997e9df1fc435c42addc9'
XLSX_SHA256 = 'bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980'
# Observed directly in the original publisher ZIP local file header (stored member).
UCI_MEMBER_CRC32 = 3843187429
UCI_MEMBER_SIZE = 45622278


def prepare():
    raw = ROOT / 'data/raw'; raw.mkdir(parents=True, exist_ok=True)
    processed = ROOT / 'data/processed'; processed.mkdir(parents=True, exist_ok=True)
    archive = raw / 'online-retail-ii.zip'
    mirror = raw / 'verified-mirror.xlsx'
    using_mirror = not archive.exists() and mirror.exists()
    if using_mirror:
        content = mirror.read_bytes()
        assert len(content) == UCI_MEMBER_SIZE
        assert hashlib.sha256(content).hexdigest() == XLSX_SHA256, 'Mirror SHA-256 mismatch'
        assert zlib.crc32(content) == UCI_MEMBER_CRC32, 'Original UCI member CRC32 mismatch'
        incoming, source_url, input_format = mirror, MIRROR, 'xlsx'
        print('Using checksum-verified XLSX mirror; provenance retained.', flush=True)
    else:
        if not archive.exists():
            part = archive.with_suffix('.zip.part')
            print('Downloading UCI Online Retail II from original publisher...', flush=True)
            with urllib.request.urlopen(SOURCE, timeout=60) as response, part.open('wb') as out:
                shutil.copyfileobj(response, out)
            with zipfile.ZipFile(part) as zf:
                assert zf.testzip() is None, 'Invalid downloaded archive'
            part.replace(archive)
        incoming, source_url, input_format = archive, SOURCE, 'zip'
    digest = hashlib.sha256(incoming.read_bytes()).hexdigest()
    csv_path, audit_path = processed / 'transactions.csv.gz', processed / 'audit.json'
    fingerprint = hashlib.sha256(Path(__file__).read_bytes() + (ROOT / 'services/ml/core.py').read_bytes()).hexdigest()
    if csv_path.exists() and audit_path.exists():
        audit = json.loads(audit_path.read_text())
        if audit.get('input_sha256') == digest and audit.get('cleaning_code_sha256') == fingerprint and audit.get('processed_sha256') == hashlib.sha256(csv_path.read_bytes()).hexdigest():
            print('Using verified cleaned cache.', flush=True)
            return pd.read_csv(csv_path, dtype={'customer':'string', 'item':str, 'invoice':str}, parse_dates=['date']), audit
    if input_format == 'zip':
        with zipfile.ZipFile(archive) as zf:
            name = next(n for n in zf.namelist() if n.endswith('.xlsx'))
            xlsx = raw / 'online_retail_II.xlsx'
            with zf.open(name) as zipped, xlsx.open('wb') as out:
                shutil.copyfileobj(zipped, out)
    else:
        xlsx = incoming
    print('Reading both original Excel sheets (about one million records)...', flush=True)
    sheets = pd.read_excel(xlsx, sheet_name=None, engine='openpyxl')
    frame = pd.concat(sheets.values(), ignore_index=True)
    assert len(frame) == 1067371 and len(sheets) == 2, 'Unexpected public dataset version or incomplete file'
    print(f'Read {len(frame):,} source rows. Cleaning...', flush=True)
    cleaned, audit = clean_transactions(frame)
    audit.update({'source_url':source_url, 'publisher_download_url':SOURCE, 'source_page':'https://archive.ics.uci.edu/dataset/502/online+retail+ii', 'license':'CC BY 4.0', 'citation':'Chen, D. (2012). Online Retail II. UCI. https://doi.org/10.24432/C5CG6D', 'input_format':input_format, 'input_sha256':digest, 'xlsx_sha256':hashlib.sha256(xlsx.read_bytes()).hexdigest(), 'mirror_used':using_mirror, 'mirror_etag':MIRROR_ETAG if using_mirror else None, 'verification':'Full XLSX SHA-256 matches published HuggingFace LFS hash; CRC32 and size match original UCI ZIP member header.' if using_mirror else 'Original publisher ZIP; ZIP member CRC verified during extraction.', 'cleaning_code_sha256':fingerprint, 'sheets':{name:len(df) for name,df in sheets.items()}, 'sales_definition':'positive merchandise sale lines, cancellations/non-positive rows excluded; not net revenue, not latent demand'})
    cleaned.to_csv(csv_path,index=False,compression='gzip')
    audit['processed_sha256'] = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    evidence = raw / 'acquisition-verification.json'
    if using_mirror and evidence.exists():
        evidence_data = json.loads(evidence.read_text())
        if evidence_data.get('xlsx_sha256') == digest:
            audit['acquisition_verification'] = evidence_data
    audit_path.write_text(json.dumps(audit,ensure_ascii=False,indent=2))
    print(f'Prepared {len(cleaned):,} clean sales rows.',flush=True)
    return cleaned,audit


if __name__ == '__main__':
    prepare()

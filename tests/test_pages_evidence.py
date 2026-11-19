import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from scripts.pages_evidence import restore


class PagesEvidenceTests(unittest.TestCase):
    def make_bundle(self, root, name='uplift-results/manifest.json', symbolic=False):
        archive = root / 'evidence.tar.gz'
        data = b'{"schema":1}'
        with tarfile.open(archive, 'w:gz') as tar:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            if symbolic:
                info.type = tarfile.SYMTYPE
                info.linkname = '/tmp/private'
                tar.addfile(info)
            else:
                tar.addfile(info, io.BytesIO(data))
        lock = root / 'lock.json'
        lock.write_text(json.dumps({'schema': 1, 'bytes': archive.stat().st_size,
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'files': {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}}}))
        return archive, lock

    def test_restores_only_checked_resources_and_preserves_existing_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, lock = self.make_bundle(root)
            restore(archive, root, lock)
            destination = root / 'apps/web/uplift-results/manifest.json'
            self.assertEqual(json.loads(destination.read_text())['schema'], 1)
            destination.write_text('existing-work')
            with self.assertRaisesRegex(ValueError, 'Existing evidence differs'):
                restore(archive, root, lock)
            self.assertEqual(destination.read_text(), 'existing-work')

    def test_rejects_archive_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, lock = self.make_bundle(root)
            archive.write_bytes(archive.read_bytes() + b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                restore(archive, root, lock)
            self.assertFalse((root / 'apps').exists())

    def test_rejects_traversal_and_symlinks_even_with_matching_archive_hash(self):
        for name, symbolic in [('../private.json', False), ('uplift-results/manifest.json', True)]:
            with self.subTest(name=name, symbolic=symbolic), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive, lock = self.make_bundle(root, name, symbolic)
                with self.assertRaises(ValueError):
                    restore(archive, root, lock)
                self.assertFalse((root / 'apps').exists())

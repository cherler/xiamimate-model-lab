import json
from pathlib import Path
import sys
import tempfile
import unittest

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services'))
from ml.evaluation_protocol import CONFIG, WORKSPACE, digest, write_json, load_development, open_final_test, require_past_labels, verify_workspace


class EvaluationProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        work = self.root / WORKSPACE
        work.mkdir(parents=True)
        (self.root / CONFIG).parent.mkdir(parents=True)
        (self.root / 'docs/evaluation').mkdir(parents=True)
        write_json(self.root / CONFIG, {'time': {'test': ['2001-02-01', '2001-03-01']},
                                      'final_evaluation': {'required_tasks': ['repurchase', 'discovery', 'weekly_sales']}})
        pd.DataFrame({'date': ['2000-12-31', '2001-01-01', '2001-01-31'], 'customer': ['001'] * 3,
                      'item': ['009'] * 3, 'category': ['01'] * 3, 'quantity': [1, 2, 3]}).to_csv(work / 'development.csv.gz', index=False)
        pd.DataFrame({'date': ['2001-02-01'], 'customer': ['001'], 'item': ['009'], 'category': ['01'], 'quantity': [7]}).to_csv(work / 'sealed-test.csv.gz', index=False)
        files = [CONFIG, f'{WORKSPACE}/development.csv.gz', f'{WORKSPACE}/sealed-test.csv.gz']
        write_json(work / 'manifest.json', {'files': {p: digest(self.root / p) for p in files}})
        write_json(self.root / 'docs/evaluation/protocol-lock.json', {'manifest_sha256': digest(work / 'manifest.json')})
        for path in ['uv.lock', 'model.py', 'development-results.json']:
            (self.root / path).write_text('fixture')
        release = {'protocol_sha256': digest(self.root / CONFIG), 'manifest_sha256': digest(work / 'manifest.json'),
                   'files': {p: digest(self.root / p) for p in ['uv.lock', 'model.py', 'development-results.json']},
                   'tasks': {task: {'selected_model': 'baseline', 'selected_parameters': {}, 'baseline': 'baseline',
                                    'features': ['past_sales'], 'development_result_path': 'development-results.json'}
                             for task in ['repurchase', 'discovery', 'weekly_sales']}}
        self.release = self.root / 'release.json'
        write_json(self.release, release)

    def test_development_reader_preserves_ids_and_excludes_origin(self):
        frame = load_development(self.root, '2001-01-01')
        self.assertEqual(len(frame), 1)
        self.assertEqual(frame.customer.iloc[0], '001')
        self.assertEqual(len(load_development(self.root)), 3)
        with self.assertRaises(ValueError):
            load_development(self.root, '2001-02-02')

    def test_labels_must_be_fully_observed(self):
        require_past_labels('2001-02-01', '2001-02-01')
        with self.assertRaises(ValueError):
            require_past_labels('2001-02-02', '2001-02-01')

    def test_mutating_split_or_manifest_is_detected(self):
        with (self.root / WORKSPACE / 'development.csv.gz').open('ab') as stream:
            stream.write(b'tampered')
        with self.assertRaises(ValueError):
            load_development(self.root)
        manifest = self.root / WORKSPACE / 'manifest.json'
        value = json.loads(manifest.read_text())
        value['files'][f'{WORKSPACE}/development.csv.gz'] = digest(self.root / WORKSPACE / 'development.csv.gz')
        write_json(manifest, value)
        with self.assertRaises(ValueError):
            verify_workspace(self.root)

    def test_final_access_requires_all_tasks_and_unchanged_source(self):
        release = json.loads(self.release.read_text())
        release['tasks'].pop('discovery')
        write_json(self.release, release)
        with self.assertRaises(ValueError):
            open_final_test(self.root, self.release)
        self.assertFalse((self.root / WORKSPACE / 'final-test-access.json').exists())
        (self.root / 'model.py').write_text('changed')
        with self.assertRaises(ValueError):
            open_final_test(self.root, self.release)

    def test_final_access_is_consumed_before_second_read(self):
        frame = open_final_test(self.root, self.release)
        self.assertEqual(frame.quantity.tolist(), [7])
        with self.assertRaises(FileExistsError):
            open_final_test(self.root, self.release)
        ledger = json.loads((self.root / WORKSPACE / 'final-test-access.json').read_text())
        self.assertEqual(ledger['status'], 'opened_consumed')

    def test_boundary_failure_still_consumes_test(self):
        # Synthetic fixture only: malformed labels must never allow retries.
        config = json.loads((self.root / CONFIG).read_text())
        config['time']['test'][0] = '2001-02-02'
        write_json(self.root / CONFIG, config)
        manifest_path = self.root / WORKSPACE / 'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][CONFIG] = digest(self.root / CONFIG)
        write_json(manifest_path, manifest)
        write_json(self.root / 'docs/evaluation/protocol-lock.json', {'manifest_sha256': digest(manifest_path)})
        release = json.loads(self.release.read_text())
        release.update(protocol_sha256=digest(self.root / CONFIG), manifest_sha256=digest(manifest_path))
        write_json(self.release, release)
        with self.assertRaises(ValueError):
            open_final_test(self.root, self.release)
        with self.assertRaises(FileExistsError):
            open_final_test(self.root, self.release)


if __name__ == '__main__':
    unittest.main()

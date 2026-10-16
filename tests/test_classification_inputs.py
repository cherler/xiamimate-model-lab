import unittest
from unittest.mock import patch
import numpy as np
from services.classification.input_audit import audit, read, AUDIT, load_development, columns, PROTOCOL
from services.classification.input_study import bootstrap, paired_counts, policy


class ClassificationInputTest(unittest.TestCase):
    def test_forbidden_partition_rejected_before_file_access(self):
        with patch('services.classification.input_audit.partition') as reader:
            for name in ['test', 'test-rows', '../test', 'report']:
                with self.assertRaises(ValueError):
                    load_development(name, None, None)
            reader.assert_not_called()

    def test_audit_binds_original_development_and_exact_feature_groups(self):
        a = audit()
        self.assertEqual(a, read(AUDIT))
        self.assertEqual({k: v['rows'] for k, v in a['partitions'].items()}, {'train': 2797, 'calibration': 728, 'validation': 429})
        self.assertEqual({k: len(v) for k, v in a['groups'].items()}, {'words': 44, 'characters': 6, 'capitals': 3})
        cfg = read(PROTOCOL)
        features = a['variants']['all']['features']
        self.assertEqual(len(columns(features, cfg, 'no_words')), 9)
        self.assertEqual(len(columns(features, cfg, 'words_only')), 44)
        self.assertGreater(a['variants']['words_only']['validation_rows_matching_reduced_train_input'], 0)

    def test_equal_quota_exposes_lost_positives_not_just_net_gain(self):
        y = np.array([1, 1, 0, 0]); groups = np.array(['a', 'b', 'c', 'd']); ids = np.arange(4)
        a, ca = policy(y, np.array([.9, .1, .8, .2]), groups, ids, .5)
        b, cb = policy(y, np.array([.1, .8, .9, .2]), groups, ids, .5)
        pair = paired_counts(y, a, b)
        self.assertEqual(ca['tp'], cb['tp'])
        self.assertEqual(pair['corrected_fn'], 1)
        self.assertEqual(pair['new_fn'], 1)

    def test_paired_group_bootstrap_same_scores_zero_and_swap_sign(self):
        y = np.array([0, 1, 0, 1, 0, 1]); groups = np.array(['a', 'b', 'c', 'd', 'e', 'f'])
        a = np.array([.1, .9, .3, .8, .6, .2]); b = np.array([.6, .8, .3, .9, .1, .2])
        cfg = {'seed': 42, 'repeats': 30}
        self.assertEqual(bootstrap(y, a, a, groups, cfg)['ap_gain'], [0, 0])
        ab = bootstrap(y, a, b, groups, cfg); ba = bootstrap(y, b, a, groups, cfg)
        np.testing.assert_allclose(ab['brier_reduction'], -np.array(ba['brier_reduction'])[::-1])


if __name__ == '__main__':
    unittest.main()

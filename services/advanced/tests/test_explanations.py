"""Sample contributions must conserve frozen outputs, including negative effects."""
import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from explain import contribution_record


class ContributionTests(unittest.TestCase):
    def test_signed_contributions_include_baseline(self):
        record = contribution_record([2, 4], [3, -2, 7], 8)
        self.assertEqual(record['base'], 7)
        self.assertEqual(record['contributions'], [3, -2])
        self.assertEqual(record['reconstruction_error'], 0)

    def test_wrong_model_score_is_rejected(self):
        with self.assertRaises(AssertionError):
            contribution_record([2], [3, 7], 11)

    def test_nonfinite_contributions_are_rejected(self):
        with self.assertRaises((ValueError, AssertionError)):
            contribution_record([2], [np.nan, 7], np.nan)

import copy
import unittest
from services.reliability.uci_audit import load
from services.reliability.uci_conditions_audit import information_audit

class UciConditionsAuditTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest, cls.data = load()

    def test_target_values_do_not_enter_information_audit(self):
        original = information_audit(self.manifest, self.data)
        changed = copy.deepcopy(self.data)
        for row in changed['weekly-series.json']:
            row['actual'] = 99999999
            row['actual_days'] = [-123] * 7
        self.assertEqual(information_audit(self.manifest, changed), original)
        self.assertEqual(original['inventory']['rows'], 144)
        self.assertFalse(original['target_outcomes_inspected_by_this_audit'])

    def test_future_missing_and_invalid_history_fail_closed(self):
        for mutate in [lambda r: r['history_dates'].__setitem__(-1, r['origin']),
                       lambda r: r['history'].pop(),
                       lambda r: r['history'].__setitem__(0, float('nan')),
                       lambda r: r['history'].__setitem__(0, -1)]:
            changed = copy.deepcopy(self.data)
            mutate(changed['weekly-series.json'][0])
            with self.assertRaises(ValueError):
                information_audit(self.manifest, changed)

    def test_parent_version_is_bound(self):
        changed = copy.deepcopy(self.manifest)
        changed['version'] = 'unverified'
        with self.assertRaises(ValueError):
            information_audit(changed, self.data)

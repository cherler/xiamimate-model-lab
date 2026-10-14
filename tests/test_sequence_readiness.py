import importlib.util
from pathlib import Path
import unittest
import pandas as pd
path=Path(__file__).resolve().parents[1]/'services/feasibility/sequence_audit.py'
spec=importlib.util.spec_from_file_location('sequence_audit',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class SequenceReadinessTests(unittest.TestCase):
    def test_no_order_created_inside_basket_and_future_excluded(self):
        f=pd.DataFrame({'customer':['a']*5,'date':pd.to_datetime(['2020-01-01']*3+['2020-01-02','2020-02-01']),'item':['x','y','x','x','z']})
        r=module.summarize(f,'2020-01-01','2020-02-01')
        self.assertEqual(r['baskets'],2);self.assertEqual(r['training_transitions'],1)
        self.assertEqual(r['targets_across_transitions'],1);self.assertEqual(r['historical_repeat_target_share'],1)
        self.assertEqual(r,module.summarize(f.iloc[::-1],'2020-01-01','2020-02-01'))
    def test_single_basket_is_not_a_long_sequence_and_subday_is_distinguished(self):
        f=pd.DataFrame({'customer':['a']*3,'date':pd.to_datetime(['2020-01-01 10:00']*2+['2020-01-01 10:01']),'item':['x','y','z']})
        r=module.summarize(f,'2020-01-01','2020-02-01')
        self.assertEqual(r['users_with_at_least']['2'],1);self.assertEqual(r['users_with_at_least_purchase_days']['2'],0)
        r=module.summarize(f.iloc[:2],'2020-01-01','2020-02-01')
        self.assertEqual(r['training_transitions'],0);self.assertIsNone(r['historical_repeat_target_share'])
        self.assertIsNone(r['gap_days_quantiles']['0.5'])
if __name__=='__main__':unittest.main()

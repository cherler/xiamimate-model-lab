import sys
import unittest
from pathlib import Path
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.competitions.dressipi import SessionBaselines, ranking_metrics, temporal_split, validate_tables


class DressipiTests(unittest.TestCase):
    def tables(self):
        views = pd.DataFrame([(1,10,'2021-03-01'), (2,20,'2021-03-02'), (3,10,'2021-04-02'), (4,20,'2021-05-02')], columns=['session_id','item_id','date'])
        targets = pd.DataFrame([(1,20,'2021-03-01'), (2,30,'2021-03-02'), (3,30,'2021-04-02'), (4,40,'2021-05-02')], columns=views.columns)
        attrs = pd.DataFrame([(10,1,1),(20,1,2),(30,1,1),(40,1,3)], columns=['item_id','feature_category_id','feature_value_id'])
        return views, targets, attrs

    def test_split_keeps_sessions_and_future_targets_out(self):
        views, targets, attrs = self.tables()
        validate_tables(views, targets, attrs)
        tr, tp, va, vp = temporal_split(views, targets)
        self.assertEqual(set(tp.session_id), {1,2})
        self.assertEqual(set(va.session_id), {3})
        self.assertEqual(set(vp.session_id), {3})
        self.assertTrue(set(tr.session_id).isdisjoint(va.session_id))

    def test_missed_candidates_stay_in_metric_denominator(self):
        result = ranking_metrics({1:20, 2:99}, {1:[10,20], 2:[10,20]}, [10,20])
        self.assertEqual(result['mrr@100'], .25)
        self.assertEqual(result['recall@100'], .5)
        self.assertEqual(result['candidate_target_coverage'], .5)
        for predictions in [{1:[10,10],2:[]},{1:[999],2:[]},{1:[10]}]:
            with self.assertRaises(ValueError):
                ranking_metrics({1:20,2:99}, predictions, [10,20])

    def test_attributes_change_ranking_and_sessions_do_not_update_model(self):
        views, targets, attrs = self.tables()
        tr, tp, *_ = temporal_split(views, targets)
        model = SessionBaselines().fit(tr, tp, attrs)
        self.assertEqual(model.predict([10], [20,30], 'cooccurrence')[0], 20)
        self.assertEqual(model.predict([10], [20,30], 'attributes')[0], 30)
        before = model.predict([10], [20,30])
        model.predict([20], [20,30])
        self.assertEqual(before, model.predict([10], [20,30]))

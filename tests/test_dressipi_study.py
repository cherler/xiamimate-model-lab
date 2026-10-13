import json
from pathlib import Path
import unittest
import tempfile
from services.competitions.dressipi_study import summarize, diagnostic_rows, CONFIG, verify_frozen
from services.competitions.m5_data import digest, write
from services.competitions.dressipi_run import FEATURES


class DressipiStudyTests(unittest.TestCase):
    def rows(self):
        ranked=[str(i) for i in range(100)]
        return [dict(session=str(i),target=t,pool=ranked+['later'],rankings={'full':ranked},
                     channels={'popularity':ranked[:10],'cooccurrence':ranked[10:],'attributes':['later']})
                for i,t in enumerate(['missing','later','10','0'])]

    def test_disjoint_failure_stages_and_unconditional_metrics(self):
        m=summarize(self.rows(),'full')
        self.assertEqual(list(m['states'].values()),[1,1,1,1])
        self.assertEqual(m['retrieval_recall'],.75)
        self.assertEqual(m['recall@100'],.5)
        self.assertEqual(m['recall@10'],.25)
        self.assertAlmostEqual(m['mrr@100'],(1+1/11)/4)
        self.assertEqual(m['conditional_recall@100'],2/3)

    def test_missing_retrieval_and_empty_subgroups_do_not_invent_scores(self):
        self.assertIsNone(summarize([], 'full')['mrr@100'])
        self.assertIsNone(summarize(self.rows()[:1],'full')['conditional_recall@100'])
        rows=self.rows(); rows[0]['rankings']['full']=['missing']
        with self.assertRaisesRegex(ValueError,'invalid ranking'):summarize(rows,'full')

    def test_groups_partition_all_sessions_and_channels_overlap_is_not_added(self):
        rows=self.rows(); cfg=json.loads(CONFIG.read_text())
        metadata=[dict(session=str(i),session_length=n,target_purchase_count=p,last_attribute_count=a,view_attribute_coverage='complete')
                  for i,(n,p,a) in enumerate([(1,0,5),(5,1,15),(6,6,25),(11,21,25)])]
        d=diagnostic_rows(rows,metadata,cfg)
        for bins in d['groups'].values():self.assertEqual(sum(g['sessions'] for g in bins),4)
        self.assertEqual(d['channels']['attributes']['hits'],1)
        self.assertEqual(d['groups']['view_attribute_coverage'][0]['sessions'],0)
        with self.assertRaisesRegex(ValueError,'cohort mismatch'):diagnostic_rows(rows,metadata[:-1],cfg)

    def test_ablation_changes_only_declared_columns_with_shared_context(self):
        cfg=json.loads(CONFIG.read_text());v=cfg['variants']
        self.assertEqual(v['full'],FEATURES)
        self.assertEqual(set(v['combined']),set(v['behavior'])|set(v['attributes']))
        self.assertEqual(set(v['full'])-set(v['combined']),{'shared_last_attributes','last_attribute_jaccard','matched_view_items'})
        self.assertTrue(cfg['validation_reused'])
        for cols in v.values():
            self.assertEqual(len(cols),len(set(cols)))
            self.assertTrue(set(cols)<=set(FEATURES))
            self.assertTrue({'session_length','session_unique_items'}<=set(cols))

    def test_frozen_evidence_rejects_changed_cached_features_and_parameters(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp)/'study';base=Path(temp)/'base';folder.mkdir();base.mkdir()
            names={'protocol_sha256':'protocol.json','training_features_sha256':'training-features.npz',
                   'validation_features_sha256':'validation-features.npz','training_queries_sha256':'training-queries.json'}
            for name in names.values():(folder/name).write_text('fixture')
            (base/'ranker.txt').write_text('fixture-model')
            frozen={k:digest(folder/n) for k,n in names.items()}
            frozen.update(base_model_sha256=digest(base/'ranker.txt'),params={'seed':42})
            write(folder/'frozen.json',frozen)
            verify_frozen(folder,base,{'params':{'seed':42}})
            with self.assertRaisesRegex(ValueError,'parameters changed'):
                verify_frozen(folder,base,{'params':{'seed':43}})
            (folder/'training-features.npz').write_text('changed')
            with self.assertRaisesRegex(ValueError,'input changed'):
                verify_frozen(folder,base,{'params':{'seed':42}})

import unittest
import numpy as np
import pandas as pd
from services.competitions.dressipi import SessionBaselines
from services.competitions.dressipi_run import stable_sample,candidate_features,evaluate,FEATURES


class DressipiPipelineTests(unittest.TestCase):
    def model(self):
        v=pd.DataFrame([('a','1','2021-02-01'),('b','2','2021-02-02')],columns=['session_id','item_id','date'])
        p=pd.DataFrame([('a','2','2021-02-01'),('b','3','2021-02-02')],columns=v.columns)
        f=pd.DataFrame([('1','1','2'),('2','1','3'),('3','1','2'),('4','9','8')],columns=['item_id','feature_category_id','feature_value_id'])
        return SessionBaselines().fit(v,p,f)
    def test_sample_does_not_depend_on_row_order_or_target(self):
        self.assertEqual(stable_sample(['4','2','3','1'],2),stable_sample(['1','2','3','4'],2))
    def test_candidate_features_are_frozen_exclude_seen_and_use_attributes(self):
        model=self.model();pool,x,ranked=candidate_features(model,['1'],['1','2','3','4'])
        self.assertNotIn('1',pool);self.assertEqual(x.shape,(len(pool),len(FEATURES)))
        self.assertEqual(ranked['cooccurrence'][0],'2');self.assertEqual(ranked['attributes'][0],'3')
        self.assertEqual(x[pool.index('3'),FEATURES.index('last_attribute_jaccard')],1)
        candidate_features(model,['2'],['1','2','3','4'])
        np.testing.assert_array_equal(x,candidate_features(model,['1'],['1','2','3','4'])[1])
    def test_missed_targets_keep_zero_in_full_session_metrics(self):
        class Ranker:
            def predict(self,x):return -np.arange(len(x))
        metrics,retrieval,samples,rows=evaluate(self.model(),Ranker(),[('a',['1'],'3'),('b',['2'],'99')],['1','2','3','4'])
        self.assertEqual(metrics['lightgbm']['sessions'],2)
        self.assertEqual(metrics['lightgbm']['recall@100'],.5)
        self.assertEqual(retrieval['retrieval_recall'],.5)
        self.assertNotIn('99',rows[1]['pool']);self.assertEqual(len(samples),2)

    def test_full_pipeline_persists_and_recomputes_metrics_on_temporary_fixtures(self):
        import tempfile,json,importlib.util
        from pathlib import Path
        from unittest.mock import patch
        from services.competitions import dressipi_run
        from services.competitions.m5_data import digest
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data=root/'data';data.mkdir();(root/'artifacts').mkdir()
            views=[];targets=[]
            for month in [2,3,4]:
                for i in range(12):
                    sid=f'{month}-{i}';item=str(1+i%2);target=str(2+i%2)
                    views.append((sid,item,f'2021-{month:02d}-02 10:00:00'))
                    targets.append((sid,target,f'2021-{month:02d}-02 11:00:00'))
            cols=['session_id','item_id','date']
            pd.DataFrame(views,columns=cols).to_csv(data/'train_sessions.csv',index=False)
            pd.DataFrame(targets,columns=cols).to_csv(data/'train_purchases.csv',index=False)
            pd.DataFrame([('1','1','2'),('2','1','3'),('3','1','2')],columns=['item_id','feature_category_id','feature_value_id']).to_csv(data/'item_features.csv',index=False)
            (data/'source.json').write_text(json.dumps({'mode':'local_research_only','public_export_allowed':False,'files':{p.name:{'sha256':digest(p)} for p in data.glob('*.csv')}}))
            from contextlib import redirect_stdout
            from io import StringIO
            with patch.object(dressipi_run,'ROOT',root),redirect_stdout(StringIO()):dressipi_run.run(data)
            pointer=json.loads((root/'artifacts/competition-dressipi.json').read_text());folder=root/'artifacts/competition-runs'/pointer['run_id']
            spec=importlib.util.spec_from_file_location('dressipi_export',Path(__file__).resolve().parents[1]/'scripts/export-dressipi.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            report,samples=module.verify_run(folder)
            self.assertEqual(report['cohort']['validation_sessions'],12)
            self.assertEqual(len(samples),12)
            self.assertEqual(report['status'],'complete_development')
            # A tampered sample cannot be exported even if the report is unchanged.
            (folder/'samples.json').write_text('[]')
            with self.assertRaisesRegex(ValueError,'checksum'):module.verify_run(folder)

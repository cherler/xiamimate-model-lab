import copy
import unittest
from services.adoption.uci import ROOT,read,load_sources,normalize,audit,activity

class UciAdoptionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p,cls.m,cls.data,cls.model=load_sources()
    def test_full_population_and_history_provenance(self):
        result=audit(self.p,self.m,self.data,self.model)
        self.assertEqual(result['rows_per_method'],4280)
        self.assertEqual(result['unique_customers'],2845)
        self.assertEqual(result['groups'],{'cold':600,'1–5':83,'6–20':391,'21+':3206})
        self.assertEqual(result['november_history_checks'],1660*9)
        self.assertEqual(result['cold_method_checks'],600*9)
    def test_missing_and_unpaired_rankings_rejected(self):
        for field,value in [('customer','not-paired'),('target','["unknown"]'),('oov_targets','999')]:
            data=copy.deepcopy(self.data);data['validation-predictions-als.csv.gz'][0][field]=value
            with self.assertRaises((ValueError,KeyError)):normalize(self.p,data,self.model)
        data=copy.deepcopy(self.data);data['validation-predictions-hybrid.csv.gz'].pop()
        with self.assertRaises(ValueError):normalize(self.p,data,self.model)
    def test_invalid_repeat_and_changed_november_history_rejected(self):
        data=copy.deepcopy(self.data);data['recommendation-diagnostics.csv.gz'][0]['repeat_share']='2'
        with self.assertRaises(ValueError):normalize(self.p,data,self.model)
        model=copy.deepcopy(self.model);model['histories']={}
        with self.assertRaises(ValueError):normalize(self.p,self.data,model)
    def test_groups_depend_on_prior_catalog_history_count_only(self):
        self.assertEqual([activity(n) for n in [0,1,5,6,20,21]],['cold','1–5','1–5','6–20','6–20','21+'])

    def test_published_rows_exactly_match_all_original_rankings_and_groups(self):
        manifest=read(ROOT/'apps/web/uci-adoption-results/manifest.json')
        payload=read(ROOT/'apps/web/uci-adoption-results'/manifest['path'])
        expected,_=normalize(self.p,self.data,self.model)
        self.assertEqual(payload['records'],expected)

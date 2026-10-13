import os
for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','VECLIB_MAXIMUM_THREADS']: os.environ[key]='2'
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services'))
import numpy as np
import pandas as pd
from ml.core import build_itemcf
from ml.recommenders import interaction_matrix,fit_als,rank_items
from ml.personalized import build_personalized,EXTRA_STRATEGIES
from ml.forecasting_v3 import enriched_features,weekly_features,weekly_training
from server import Artifacts
from test_ml import fixture


class RoundThreeTests(unittest.TestCase):
    def test_personal_events_are_per_invoice_and_never_future(self):
        train=fixture()
        repeated=train.iloc[[0]].assign(invoice='new_invoice',date=pd.Timestamp('2011-01-03'))
        train=pd.concat([train,train.iloc[[0]],repeated],ignore_index=True)
        model=build_itemcf(train);users,x=interaction_matrix(model)
        personal=build_personalized(train,users,model['items'],'2011-02-01')
        i,j=users.index('1'),model['items'].index('10000')
        self.assertEqual(personal['frequency_matrix'][i,j],2)
        self.assertAlmostEqual(personal['recency_matrix'][i,j],1/30)
        self.assertAlmostEqual(personal['decay_matrix'][i,j],np.exp(-31/90)+np.exp(-29/90))
        with self.assertRaises(ValueError):build_personalized(train,users,model['items'],'2011-01-02')

    def test_personal_strategies_cold_start_exclusions_and_explanations(self):
        train=fixture();model=build_itemcf(train);users,x=interaction_matrix(model)
        model.update(users=users,_user_index={u:i for i,u in enumerate(users)},schema_version=3,hybrid_als_weight=.5,as_of='2011-02-01')
        model.update(build_personalized(train,users,model['items'],'2011-02-01'))
        model.update(fit_als(x,dict(factors=3,regularization=.1,confidence_increment=1,iterations=8),threads=1))
        store=Artifacts();store.model=model;store.run_id='test';store.profiles={}
        for name in EXTRA_STRATEGIES:
            self.assertEqual(rank_items(model,'new',name)[0],rank_items(model,'new','popular')[0])
            result=store.recommend({'customer_id':'1','strategy':name,'exclude_purchased':True})
            self.assertFalse(any(i['purchased_before'] for i in result['items']))
            self.assertTrue(all(i['reason']['type']=='personal_history' for i in result['items']))

    def test_weekly_and_enriched_features_cannot_read_future(self):
        values=np.arange(160,dtype=float);dates=pd.date_range('2011-01-01',periods=160)
        enriched=enriched_features(values,dates,100,28,0,1);weekly=weekly_features(values,dates,100,0,1)
        x,y=weekly_training(values[None,:],dates,100)
        self.assertEqual(len(y),100-7-56+1)
        self.assertEqual(y[-1],sum(range(93,100)))
        values[100:]=999999
        self.assertEqual(enriched,enriched_features(values,dates,100,28,0,1));self.assertEqual(weekly,weekly_features(values,dates,100,0,1))
        x2,y2=weekly_training(values[None,:],dates,100)
        np.testing.assert_array_equal(x,x2);np.testing.assert_array_equal(y,y2)

    def test_matching_weekday_features_align_to_target_date(self):
        values=np.tile(np.arange(7,dtype=float),20);dates=pd.date_range('2011-01-03',periods=len(values))
        vector=enriched_features(values,dates,70,5,0,1)
        self.assertAlmostEqual(vector[14],np.log1p(4))
        self.assertAlmostEqual(vector[15],np.log1p(4))


if __name__=='__main__':unittest.main()

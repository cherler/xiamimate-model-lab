import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services'))
import numpy as np
import pandas as pd
from ml.core import clean_transactions, next_baskets, build_itemcf, rank_items, ranking_metrics, paired_bootstrap
from ml.forecasting import features, forecast_metrics, training_origins
from server import Artifacts


def fixture():
    rows = []
    for user, items in [('1', ['10000', '10001']), ('2', ['10000', '10001', '10002']), ('3', ['10002', '10003']), ('4', ['10003'])]:
        for item in items:
            rows.append(dict(customer=user, item=item, date=pd.Timestamp('2011-01-01'), name=item, quantity=1, price=1, invoice=user, country='United Kingdom'))
    return pd.DataFrame(rows)


class DataTests(unittest.TestCase):
    def test_exclusive_audit_and_missing_customers(self):
        good = dict(Invoice='123', StockCode='10000', Description='A', Quantity=2, InvoiceDate='2011-01-01', Price=3, **{'Customer ID':1}, Country='United Kingdom')
        rows = [good, good, {**good, 'Invoice':'C123', 'Quantity':-1}, {**good, 'Quantity':0}, {**good, 'Price':0}, {**good, 'StockCode':'POST'}, {**good, 'Customer ID':None}, {**good, 'InvoiceDate':'invalid'}]
        cleaned, audit = clean_transactions(pd.DataFrame(rows))
        self.assertEqual(len(cleaned), 2)
        self.assertEqual(audit['missing_customer_rows'], 1)
        self.assertEqual(sum(x['rows'] for x in audit['removed']) + audit['clean_rows'], audit['raw_rows'])

    def test_next_basket_boundary_and_timestamp_ties(self):
        df = fixture().iloc[:1].copy()
        rows = [dict(df.iloc[0], date=pd.Timestamp(d), item=item) for d,item in [('2011-09-30','old'), ('2011-10-01','A'), ('2011-10-01','B'), ('2011-10-02','C'), ('2011-11-01','D')]]
        self.assertEqual(next_baskets(pd.DataFrame(rows),'2011-10-01','2011-11-01'), {'1':{'A','B'}})

    def test_future_items_never_enter_training_catalog(self):
        train = fixture()
        future = train.assign(date=pd.Timestamp('2012-01-01'), item='99999')
        combined = pd.concat([train,future])
        model = build_itemcf(combined[combined.date < '2011-10-01'])
        self.assertNotIn('99999',model['items'])
        indices, _, fallback = rank_items(model, 'new', k=10)
        popular, _, _ = rank_items(model,'new','popular',k=10)
        self.assertTrue(fallback)
        self.assertEqual(indices,popular)
        ranked, _, _ = rank_items(model,'1',exclude=True)
        self.assertTrue(set(model['items'][i] for i in ranked).isdisjoint({'10000','10001'}))

    def test_hand_calculated_metrics_keep_unseen_targets(self):
        m = ranking_metrics(['A','B'], {'A','unseen'}, 2)
        self.assertEqual(m['recall'], .5)
        self.assertAlmostEqual(m['ndcg'], 1/(1+1/np.log2(3)))
        self.assertEqual(m['hit_rate'],1)
        base = [{'customer':'1','recall':0}, {'customer':'2','recall':0}]
        better = [{'customer':'1','recall':.5}, {'customer':'2','recall':.5}]
        ci = paired_bootstrap(base,better,'recall')
        self.assertEqual([ci['difference'],ci['low'],ci['high']], [.5,.5,.5])

    def test_forecast_future_sales_do_not_change_features(self):
        values = np.arange(120,dtype=float)
        dates = pd.date_range('2011-01-01',periods=120)
        first = features(values, dates,60,28,0,1)
        values[60:] = 999999
        self.assertEqual(first,features(values,dates,60,28,0,1))
        m = forecast_metrics([10,0],[8,2])
        self.assertEqual(m, {'mae':2.,'wape':.4,'bias':0.})
        self.assertIsNone(forecast_metrics([0,0],[1,1])['wape'])

    def test_every_forecast_training_label_precedes_cutoff(self):
        for cutoff in [84, 100, 600]:
            origins = list(training_origins(cutoff))
            self.assertTrue(origins)
            self.assertTrue(all(origin + 27 < cutoff for origin in origins))
            self.assertTrue(all(origin >= 56 for origin in origins))

    def test_request_contract(self):
        store = Artifacts(); store.model = build_itemcf(fixture()); store.model['as_of']='2011-10-01'; store.run_id='test'; store.profiles={}
        for payload in [[], {'limit':True}, {'limit':0}, {'exploration':float('nan')}, {'exclude_purchased':'false'}, {'strategy':'unknown'}, {'customer_id':'<script>'}]:
            with self.assertRaises(ValueError): store.recommend(payload)
        output = store.recommend({'customer_id':'new'})
        self.assertTrue(output['fallback'])
        self.assertTrue(output['evaluation_policy_matches'])
        self.assertFalse(store.recommend({'limit':4})['evaluation_policy_matches'])

if __name__ == '__main__': unittest.main()

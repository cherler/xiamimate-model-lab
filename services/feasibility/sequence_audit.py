"""Historical sequence audit only: never trains or opens Ta Feng final labels."""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'services'))
from ml.evaluation_protocol import load_development

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def summarize(frame,start,end):
    f=frame[(frame.date>=pd.Timestamp(start))&(frame.date<pd.Timestamp(end))&frame.customer.notna()].copy()
    if f.empty:raise ValueError('No historical events in requested window')
    # Items sharing a timestamp are a SET. IDs never create an order.
    baskets=f.groupby(['customer','date']).item.agg(lambda x:set(x)).sort_index()
    lengths=baskets.groupby(level=0).size();sizes=baskets.map(len)
    gaps=[];repeat=0;targets=0;transitions=0
    for _,seq in baskets.groupby(level=0):
        seen=set();previous=None
        for (_,t),items in seq.items():
            if previous is not None:
                gaps.append((t-previous).total_seconds()/86400);repeat+=len(items&seen);targets+=len(items);transitions+=1
            seen.update(items);previous=t
    quant=lambda x:{str(q):float(np.quantile(x,q)) if len(x) else None for q in [0,.25,.5,.75,.9,.95,1]}
    day_lengths=f.assign(day=f.date.dt.normalize()).groupby('customer').day.nunique()
    transition_counts=(lengths-1).clip(lower=0).sort_values(ascending=False)
    result={'start_inclusive':start,'end_exclusive':end,'rows':len(f),'customers':len(lengths),'items':f.item.nunique(),
        'baskets':len(baskets),'basket_size_quantiles':quant(sizes),'sequence_length_quantiles':quant(lengths),
        'multi_item_baskets':int((sizes>1).sum()),'multi_item_basket_share':float((sizes>1).mean()),
        'users_with_at_least':{str(n):int((lengths>=n).sum()) for n in [2,3,5,10,20]},
        'training_transitions':transitions,'targets_across_transitions':targets,'previously_seen_targets':repeat,
        'historical_repeat_target_share':repeat/targets if targets else None,
        'purchase_day_sequence_quantiles':quant(day_lengths),'users_with_at_least_purchase_days':{str(n):int((day_lengths>=n).sum()) for n in [2,3,5,10,20]},
        'subday_transition_count':sum(g<1 for g in gaps),'gap_days_quantiles':quant(gaps),
        'top_one_percent_users_transition_share':float(transition_counts.head(max(1,int(np.ceil(len(lengths)*.01)))).sum()/transitions) if transitions else None,
        'intraday_rows':int((f.date!=f.date.dt.normalize()).sum())}
    if 'invoice' in f:
        times=f.groupby(['customer','invoice']).date.nunique()
        invoice_counts=f.groupby(['customer','date']).invoice.nunique()
        result.update(invoices=int(len(times)),invoices_spanning_timestamps=int((times>1).sum()),timestamps_with_multiple_invoices=int((invoice_counts>1).sum()))
    return result

def main():
    source=ROOT/'data/processed/transactions.csv.gz';audit=json.loads((ROOT/'data/processed/audit.json').read_text())
    if digest(source)!=audit['processed_sha256']:raise ValueError('UCI source changed')
    uci=pd.read_csv(source,dtype={'customer':str,'item':str,'invoice':str},parse_dates=['date'])
    tafeng=load_development(ROOT,cutoff='2001-02-01')
    report={'schema':1,'purpose':'historical data readiness; not trained SASRec, independent test or next-basket accuracy',
        'event_policy':'merge same-customer same-timestamp items into an unordered basket; sequence only between strictly different timestamps',
        'script_sha256':digest(__file__),'uci_source_sha256':digest(source),'tafeng_development_sha256':digest(ROOT/'artifacts/protocols/ta-feng-evaluation-v1/development.csv.gz'),
        'uci':[summarize(uci,'2010-12-01',end) for end in ['2011-06-01','2011-09-01']],
        'tafeng':[summarize(tafeng,'2000-11-01',end) for end in ['2001-01-01','2001-02-01']]}
    out=ROOT/'docs/evaluation/sequence-readiness-v1.json';out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n');print(out)
    for name in ['uci','tafeng']:
        for r in report[name]:print(name,r['end_exclusive'],r['customers'],r['sequence_length_quantiles'],r['multi_item_basket_share'],r['users_with_at_least'],r['training_transitions'])
if __name__=='__main__':main()

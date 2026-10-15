"""Frozen-protocol residual interval replay; no fitting or modification of forecasts."""
import json
import math
from pathlib import Path
from services.reliability.uci_audit import ROOT, RUN, load, audit, sha
PROTOCOL=Path(__file__).with_name('uci-protocol.json')
def scale(row):return max(1.,sum(row['history'])/8)
def quantile(scores,coverage=.9):
    k=math.ceil((len(scores)+1)*coverage)
    if not scores or k>len(scores):return None
    return sorted(scores)[k-1]
def interval_metrics(rows,model,alpha=.1):
    part=[r for r in rows if r['intervals'] is not None]
    if not part:return None
    covered=below=above=0;width=normalized=score=0.
    for r in part:
        lo,hi=r['intervals'][model]['lower'],r['intervals'][model]['upper'];y=r['actual']
        covered+=lo<=y<=hi;below+=y<lo;above+=y>hi
        width+=hi-lo;normalized+=(hi-lo)/r['scale'];score+=hi-lo+2/alpha*max(lo-y,y-hi,0)
    n=len(part)
    return {'n':n,'covered':covered,'below':below,'above':above,'coverage':covered/n,'mean_width':width/n,'mean_scaled_width':normalized/n,'interval_score':score/n}
def point_metrics(rows,model):
    total=sum(r['actual'] for r in rows);error=sum(abs(r['actual']-r['predictions'][model]) for r in rows)
    return {'n':len(rows),'wape':error/total if total else None,'mae':error/len(rows),'bias':sum(r['predictions'][model]-r['actual'] for r in rows)/total if total else None}
def evaluate(rows,protocol):
    models=protocol['models'];origins=sorted(set(r['origin'] for r in rows));records=[];windows=[]
    for origin in origins:
        past=[r for r in rows if r['end']<origin]
        past_origins=sorted(set(r['origin'] for r in past))
        eligible=len(past_origins)>=protocol['minimum_complete_windows'] and len(past)>=protocol['minimum_rows']
        q={m:quantile([abs(r['actual']-r['predictions'][m])/scale(r) for r in past],protocol['target_coverage']) for m in models} if eligible else None
        if eligible and any(v is None for v in q.values()):raise ValueError('Insufficient quantile rank')
        current=[]
        for r in sorted((r for r in rows if r['origin']==origin),key=lambda r:r['item']):
            for v in [r['actual'],*r['history'],*[r['predictions'][m] for m in models]]:
                if not math.isfinite(v) or v<0:raise ValueError('Invalid nonnegative sales')
            s=scale(r)
            record={'origin':origin,'end':r['end'],'item':r['item'],'actual':r['actual'],'scale':s,'predictions':r['predictions'],'intervals':{m:{'lower':max(0,r['predictions'][m]-q[m]*s),'upper':r['predictions'][m]+q[m]*s} for m in models} if eligible else None}
            current.append(record)
        records.extend(current)
        windows.append({'origin':origin,'end':current[0]['end'],'calibration_origins':past_origins,'calibration_n':len(past),'calibration_end':max((r['end'] for r in past),default=None),'eligible':eligible,'quantiles':q,'models':{m:{'point':point_metrics(current,m),'interval':interval_metrics(current,m)} for m in models}})
    eligible=[r for r in records if r['intervals'] is not None]
    summary={m:{'all_point':point_metrics(records,m),'eligible_point':point_metrics(eligible,m),'interval':interval_metrics(eligible,m)} for m in models}
    return {'records':records,'windows':windows,'summary':summary,'by_item':{item:{m:interval_metrics([r for r in eligible if r['item']==item],m) for m in models} for item in sorted(set(r['item'] for r in rows))}}
def export():
    manifest,data=load();a=audit(manifest,data);raw_protocol=PROTOCOL.read_bytes();p=json.loads(raw_protocol)
    if p['sources']!=a['sources'] or p['parent_run']!=RUN:raise ValueError('Frozen protocol parent changed')
    audited=json.loads((ROOT/'docs/evaluation/uci-reliability-audit-v1.json').read_text())
    if a!=audited:raise ValueError('Audit inventory changed')
    result={'schema':'uci-reliability-v1','parent_run':RUN,'parent_version':manifest['version'],'sources':a['sources'],'protocol':p,'protocol_sha256':sha(raw_protocol),'exporter_sha256':sha(Path(__file__).read_bytes()),'audit':a,**evaluate(data['weekly-series.json'],p),'notice':'Online Retail II, Chen (2012), UCI, DOI 10.24432/C5CG6D, CC BY 4.0. Derived historical interval diagnostics; known development data, not new independent evaluation.'}
    raw=json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode();digest=sha(raw);path=f'{digest[:16]}/case.json';root=ROOT/'apps/web/uci-reliability-results'
    (root/path).parent.mkdir(parents=True,exist_ok=True);(root/path).write_bytes(raw)
    m={'schema':result['schema'],'path':path,'sha256':digest,'parent_run':RUN,'protocol_sha256':result['protocol_sha256']}
    (root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
    (ROOT/'docs/evaluation/uci-reliability-v1.json').write_text(json.dumps({**m,'exporter_sha256':result['exporter_sha256'],'eligible_windows':8,'eligible_rows':96,'summary':result['summary']},indent=2)+'\n')
    print(json.dumps({m:result['summary'][m] for m in p['primary_pair']},indent=2))
if __name__=='__main__':export()

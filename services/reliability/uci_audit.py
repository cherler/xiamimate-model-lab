"""Audit only the frozen, already published UCI window inventory."""
from pathlib import Path
import hashlib
import json
from datetime import date, timedelta
ROOT=Path(__file__).resolve().parents[2]
RUN='retail-20261012T001149Z'
def sha(data):return hashlib.sha256(data).hexdigest()
def load():
    root=ROOT/'apps/web/uci-results'
    manifest=json.loads((root/'manifest.json').read_text())
    if manifest['run_id']!=RUN:raise ValueError('Unexpected UCI parent')
    result={}
    for name in ['report.json','weekly-series.json','forecast-series.json']:
        raw=(root/manifest['version']/name).read_bytes()
        if sha(raw)!=manifest['files'][name]['sha256']:raise ValueError('Parent hash mismatch')
        result[name]=json.loads(raw)
    return manifest,result

def audit(manifest,data):
    result={'schema':'uci-reliability-audit-v1','parent_run':RUN,'parent_version':manifest['version'],
            'sources':{n:manifest['files'][n]['sha256'] for n in data},'tasks':{},
            'selection_feedback':'Weekly parameters were selected over all 12 known development windows; this is not a new independent test.',
            'decision':'Weekly pooled residual development diagnostic only; no per-SKU guarantee. Daily intervals deferred: only 3 forecast origins.'}
    for task,name,horizon in [('weekly','weekly-series.json',7),('daily','forecast-series.json',28)]:
        rows=data[name];origins=sorted(set(r['origin'] for r in rows));items=sorted(set(r['item'] for r in rows));windows=[]
        if len(rows)!=len(origins)*len(items) or len(set((r['origin'],r['item']) for r in rows))!=len(rows):raise ValueError('Non-Cartesian inventory')
        ends={o:(date.fromisoformat(o)+timedelta(days=horizon-1)).isoformat() for o in origins}
        for o in origins:
            part=[r for r in rows if r['origin']==o]
            if sorted(r['item'] for r in part)!=items:raise ValueError('Item scope drift')
            for r in part:
                if len(r['history'])!=56 or r['history_dates']!=[(date.fromisoformat(o)+timedelta(days=i)).isoformat() for i in range(-56,0)]:raise ValueError('Invalid history availability')
                if task=='weekly' and r['end']!=ends[o]:raise ValueError('Invalid end')
                if task=='daily' and (r['dates'][0]!=o or r['dates'][-1]!=ends[o]):raise ValueError('Invalid daily horizon')
            past=[a for a in origins if ends[a]<o]
            windows.append({'origin':o,'end':ends[o],'items':len(part),'past_complete_windows':len(past),'past_product_windows':len(past)*len(items),'eligible_at_four_windows':len(past)>=4})
        if any(ends[a]>=b for a,b in zip(origins,origins[1:])):raise ValueError('Overlapping targets')
        result['tasks'][task]={'rows':len(rows),'items':items,'horizon':horizon,'windows':windows,'eligible_windows':sum(w['eligible_at_four_windows'] for w in windows)}
    return result
if __name__=='__main__':
    m,d=load();out=audit(m,d)
    (ROOT/'docs/evaluation/uci-reliability-audit-v1.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:{'rows':v['rows'],'windows':len(v['windows']),'eligible_windows':v['eligible_windows']} for k,v in out['tasks'].items()}))

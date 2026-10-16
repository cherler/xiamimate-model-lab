"""Label-free calibration and causal, capacity-limited alert replay."""
from collections import deque
import numpy as np
DAY=86400000
METHODS=['static','rolling','isolation']

def replay(rows, model, threshold, budget=None, cooldown=60):
    if not np.isfinite(threshold) or threshold<0 or cooldown<0 or not np.isfinite(cooldown):raise ValueError('Invalid policy')
    if budget is not None and (not isinstance(budget,int) or budget<1):raise ValueError('Invalid budget')
    last=-float('inf');recent=deque();alerts=[];states=[]
    for i,row in enumerate(rows):
        t=row['t'];score=(row.get('scores') or {}).get(model)
        if i and t<=rows[i-1]['t']:raise ValueError('Nonmonotonic time')
        while recent and recent[0]<=t-DAY:recent.popleft()
        if score is None:state='unscorable'
        elif not np.isfinite(score):raise ValueError('Nonfinite score')
        elif score<=threshold:state='quiet'
        elif t-last<cooldown*60000:state='cooldown'
        elif budget is not None and len(recent)>=budget:state='capacity'
        else:
            state='alert';last=t;recent.append(t);alerts.append(i)
        states.append(state)
    return alerts,states

def calibrate(rows,model,budget,days,quantiles):
    if days<=0:raise ValueError('Empty calibration')
    values=[r['scores'][model] for r in rows if r.get('scores') is not None]
    if not values:raise ValueError('No calibration scores')
    candidates=[]
    for q in quantiles:
        threshold=float(np.quantile(values,q,method='higher'))
        count=len(replay(rows,model,threshold)[0]);candidates.append({'q':q,'threshold':threshold,'alerts':count,'per_day':count/days})
    valid=[c for c in candidates if c['per_day']<=budget]
    winner=min(valid,key=lambda c:(c['threshold'],c['q']))
    return {**winner,'days':days,'valid_rows':len(values),'candidates':candidates}

def evaluate(rows,windows,model,threshold,days,budget=None):
    alerts,states=replay(rows,model,threshold,budget);events=[];outside=0
    for i in alerts:
        if not any(w['start']<=rows[i]['t']<=w['end'] for w in windows):outside+=1
    for w in windows:
        indexes=[i for i,r in enumerate(rows) if w['start']<=r['t']<=w['end']]
        hits=[i for i in indexes if states[i]=='alert'];valid=[i for i in indexes if states[i]!='unscorable']
        blocked={k:sum(states[i]==k for i in indexes) for k in ['cooldown','capacity']}
        reason=None if hits else 'unscorable' if not valid else 'no_signal' if not sum(blocked.values()) else 'mixed' if all(blocked.values()) else 'cooldown' if blocked['cooldown'] else 'capacity'
        events.append({'detected':bool(hits),'alerts':len(hits),'first_alert':rows[hits[0]]['t'] if hits else None,'delay_minutes':(rows[hits[0]]['t']-w['start'])/60000 if hits else None,'miss_reason':reason,'blocked':blocked,'scoreable_rows':len(valid)})
    detected=sum(e['detected'] for e in events)
    return {'alerts':alerts,'events':events,'alert_count':len(alerts),'outside_alerts':outside,'outside_per_day':outside/days,'alerts_per_day':len(alerts)/days,'days':days,'event_count':len(events),'detected':detected,'missed':len(events)-detected,'recall':detected/len(events) if events else None,'duplicates':len(alerts)-outside-detected,'suppressed_capacity':states.count('capacity'),'suppressed_cooldown':states.count('cooldown'),'unscorable_rows':states.count('unscorable')}

def summaries(series):
    result={}
    for budget in [1,3,6]:
        result[str(budget)]={}
        for model in METHODS:
            result[str(budget)][model]={}
            for mode in ['capped','uncapped']:
                rs=[s['results'][str(budget)][model][mode] for s in series]
                total={k:sum(r[k] for r in rs) for k in ['alert_count','outside_alerts','days','event_count','detected','missed','duplicates','suppressed_capacity','suppressed_cooldown','unscorable_rows']}
                total['recall']=total['detected']/total['event_count'] if total['event_count'] else None
                total['outside_per_day']=total['outside_alerts']/total['days'];total['alerts_per_day']=total['alert_count']/total['days']
                result[str(budget)][model][mode]=total
    return result

def brief(s):
    return {**{k:v for k,v in s.items() if k not in ['rows','calibration','results']},'thresholds':{b:{m:{k:v for k,v in x.items() if k!='candidates'} for m,x in ms.items()} for b,ms in s['calibration'].items()},'results':{b:{m:{mode:{k:v for k,v in r.items() if k!='alerts'} for mode,r in modes.items()} for m,modes in ms.items()} for b,ms in s['results'].items()}}

"""Single-period constrained replenishment, independent of evaluation outcomes."""
import time
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import lil_matrix

POLICIES = ['point', 'buffer', 'milp']


def inputs(items, model, budget_ratio, capacity_ratio, shortage_ratio, cfg):
    history=np.array([r['weeks'] for r in items],float);means=history.mean(axis=1)
    pred=np.array([r['predictions'][model] for r in items],float)
    demand=np.divide(history,means[:,None],out=np.ones_like(history),where=means[:,None]>0)*pred[:,None]
    initial=np.array([r['initial'] for r in items],int);cost=np.array([r['cost'] for r in items],int)
    price=np.array([r['price'] for r in items],float)
    if not np.isfinite(demand).all() or (demand<0).any() or (cost<=0).any():raise ValueError('Invalid inputs')
    return {'initial':initial,'cost':cost,'holding':cost*cfg['holding_purchase_ratio'],'penalty':price*shortage_ratio,
            'demand':demand,'prediction':pred,'pack':cfg['pack_size'],
            'budget':int(np.floor(budget_ratio*np.dot(cost,np.maximum(means-initial,0)))),
            'capacity':max(int(initial.sum()),int(np.floor(capacity_ratio*means.sum()))),
            'ids':[r['id'] for r in items]}


def metrics(x, packs, actual=None):
    packs=np.asarray(packs);units=packs*x['pack'];stock=x['initial']+units
    demand=x['demand'] if actual is None else np.asarray(actual)[:,None]
    leftover=np.maximum(stock[:,None]-demand,0);shortage=np.maximum(demand-stock[:,None],0)
    purchase=float(np.dot(x['cost'],units));holding=float((leftover*x['holding'][:,None]).sum(axis=0).mean());penalty=float((shortage*x['penalty'][:,None]).sum(axis=0).mean())
    demand_total=float(demand.sum(axis=0).mean());short=float(shortage.sum(axis=0).mean())
    return {'purchase':purchase,'holding':holding,'shortage_cost':penalty,'total_cost':purchase+holding+penalty,
            'shortage_units':short,'leftover_units':float(leftover.sum(axis=0).mean()),'demand_units':demand_total,
            'fill_rate':1-short/demand_total if demand_total else None,'ordered_units':int(units.sum()),'stock_units':int(stock.sum()),
            'budget_slack':float(x['budget']-purchase),'capacity_slack':int(x['capacity']-stock.sum()),
            'feasible':bool(np.isfinite(packs).all() and (packs>=0).all() and np.equal(packs,np.floor(packs)).all() and purchase<=x['budget']+1e-6 and stock.sum()<=x['capacity'])}


def rule(x, buffer=False):
    target=x['prediction']+(x['demand'].std(axis=1) if buffer else 0)
    wanted=np.ceil(np.maximum(target-x['initial'],0)/x['pack']).astype(int)
    raw_spend=float(np.dot(wanted,x['cost']*x['pack']));raw_units=int(wanted.sum()*x['pack'])
    ratio=min(1,x['budget']/raw_spend if raw_spend else 1,(x['capacity']-x['initial'].sum())/raw_units if raw_units else 1)
    packs=np.floor(wanted*max(ratio,0)).astype(int)
    remaining=x['budget']-int(np.dot(packs,x['cost']*x['pack']));slots=x['capacity']-int(x['initial'].sum()+packs.sum()*x['pack'])
    while slots>=x['pack']:
        eligible=[i for i in range(len(packs)) if packs[i]<wanted[i] and x['cost'][i]*x['pack']<=remaining]
        if not eligible:break
        i=min(eligible,key=lambda i:(-(wanted[i]-packs[i]),x['ids'][i]));packs[i]+=1;remaining-=x['cost'][i]*x['pack'];slots-=x['pack']
    return packs


def optimize(x, options):
    n,s=x['demand'].shape;size=n+2*n*s
    objective=np.r_[x['cost']*x['pack'],np.repeat(x['holding']/s,s),np.repeat(x['penalty']/s,s)]
    a=lil_matrix((n*s+2,size));lower=np.zeros(n*s+2);upper=np.zeros(n*s+2)
    for i in range(n):
        for j in range(s):
            k=i*s+j;a[k,i]=x['pack'];a[k,n+k]=-1;a[k,n+n*s+k]=1
            lower[k]=upper[k]=x['demand'][i,j]-x['initial'][i]
    a[-2,:n]=x['cost']*x['pack'];a[-1,:n]=x['pack'];lower[-2:]=-np.inf
    upper[-2]=x['budget'];upper[-1]=x['capacity']-x['initial'].sum()
    started=time.perf_counter()
    result=milp(objective,integrality=np.r_[np.ones(n),np.zeros(2*n*s)],bounds=Bounds(np.zeros(size),np.full(size,np.inf)),constraints=LinearConstraint(a.tocsr(),lower,upper),options=options)
    seconds=time.perf_counter()-started
    if result.status!=0 or result.x is None:raise RuntimeError(f'MILP not optimal: {result.status} {result.message}')
    packs=np.rint(result.x[:n]).astype(int)
    if not np.allclose(result.x[:n],packs,atol=1e-5,rtol=0):raise ValueError('Nonintegral solution')
    m=metrics(x,packs)
    if not m['feasible'] or not np.isclose(m['total_cost'],result.fun,rtol=1e-7,atol=1e-3):raise ValueError('Solver objective/constraints mismatch')
    return {'packs':packs.tolist(),'status':int(result.status),'message':result.message,'gap':float(result.mip_gap),'dual_bound':float(result.mip_dual_bound),'objective':float(result.fun),'seconds':seconds}

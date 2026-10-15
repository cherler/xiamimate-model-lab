"""Single controlled change: aggregate scenario service constraint, no outcomes input."""
import time
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import lil_matrix
from services.decision.core import metrics

def solve(x,options,target=None,max_service=False):
    if target is not None and (not np.isfinite(target) or not 0<=target<=1):raise ValueError('Invalid target')
    n,s=x['demand'].shape;size=n+2*n*s;extra=int(target is not None)
    objective=np.r_[x['cost']*x['pack'],np.repeat(x['holding']/s,s),np.repeat(x['penalty']/s,s)]
    if max_service:objective=np.r_[np.zeros(n+n*s),np.full(n*s,1/s)]
    a=lil_matrix((n*s+2+extra,size));lower=np.full(a.shape[0],-np.inf);upper=np.zeros(a.shape[0])
    for i in range(n):
        for j in range(s):
            k=i*s+j;a[k,i]=x['pack'];a[k,n+k]=-1;a[k,n+n*s+k]=1
            lower[k]=upper[k]=x['demand'][i,j]-x['initial'][i]
    a[n*s,:n]=x['cost']*x['pack'];upper[n*s]=x['budget']
    a[n*s+1,:n]=x['pack'];upper[n*s+1]=x['capacity']-x['initial'].sum()
    if target is not None:
        a[-1,n+n*s:]=1/s;upper[-1]=(1-target)*float(x['demand'].sum(axis=0).mean())
    started=time.perf_counter()
    result=milp(objective,integrality=np.r_[np.ones(n),np.zeros(2*n*s)],bounds=Bounds(np.zeros(size),np.full(size,np.inf)),constraints=LinearConstraint(a.tocsr(),lower,upper),options=options)
    out={'status':int(result.status),'message':str(result.message),'seconds':time.perf_counter()-started,'packs':None,'expected':None,'objective':None,'dual_bound':None,'gap':None}
    # Nonoptimal incumbents are not presented as certified plans; preserve status explicitly.
    if result.status!=0:return out
    packs=np.rint(result.x[:n]).astype(int);m=metrics(x,packs)
    if not np.allclose(result.x[:n],packs,atol=1e-5,rtol=0) or not m['feasible']:raise ValueError('Invalid solver order')
    value=m['shortage_units'] if max_service else m['total_cost']
    if not np.isclose(value,result.fun,rtol=1e-7,atol=1e-3):raise ValueError('Objective mismatch')
    if target is not None and m['fill_rate'] is not None and m['fill_rate']<target-1e-8:raise ValueError('Service constraint violated')
    if not np.isfinite(result.mip_dual_bound) or not np.isfinite(result.mip_gap):raise ValueError('Missing optimality bound')
    out.update(packs=packs.tolist(),expected=m,objective=float(result.fun),dual_bound=float(result.mip_dual_bound),gap=float(result.mip_gap))
    return out

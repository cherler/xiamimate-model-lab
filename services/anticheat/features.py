"""Causal, pre-shot feature extraction. No hit/kill/label or future frames in X."""
import numpy as np

NAMES=['转动幅度均值','转动幅度95分位','单帧最大转动','水平幅度均值','垂直幅度均值','加速度均方根','急动幅度95分位','静止帧占比','水平转向频率','垂直转向频率','轨迹直达率','末段转动占比','水平垂直相关','步长变异系数']

def features(windows):
    w=np.asarray(windows,dtype=np.float64)
    if w.ndim!=3 or w.shape[1:]!=(35,2) or not np.isfinite(w).all():
        raise ValueError('Expected finite (n,35,2) pre-shot trajectories')
    speed=np.linalg.norm(w,axis=2); acc=np.diff(w,axis=1); jerk=np.diff(acc,axis=1)
    total=speed.sum(axis=1); std=w.std(axis=1);center=w-w.mean(axis=1,keepdims=True)
    corr=(center[:,:,0]*center[:,:,1]).mean(axis=1)/(std[:,0]*std[:,1]+1e-8)
    out=np.column_stack([speed.mean(axis=1),np.quantile(speed,.95,axis=1),speed.max(axis=1),np.abs(w[:,:,0]).mean(axis=1),np.abs(w[:,:,1]).mean(axis=1),np.sqrt((acc**2).sum(axis=2).mean(axis=1)),np.quantile(np.linalg.norm(jerk,axis=2),.95,axis=1),(speed<1e-5).mean(axis=1),((w[:,1:,0]*w[:,:-1,0])<0).mean(axis=1),((w[:,1:,1]*w[:,:-1,1])<0).mean(axis=1),np.linalg.norm(w.sum(axis=1),axis=1)/(total+1e-8),speed[:,-5:].sum(axis=1)/(total+1e-8),corr,speed.std(axis=1)/(speed.mean(axis=1)+1e-8)])
    return out.astype(np.float32)

def extract(d):
    a=np.asarray(d['actions'],dtype=float); ammo=np.asarray(d['ammos']);weapon=np.asarray(d['weapons'])
    if a.ndim!=2 or a.shape[1]<6 or len(a)!=len(ammo) or len(a)!=len(weapon):
        raise ValueError('Misaligned telemetry')
    windows=[];ticks=[];last=-100
    # Ammo decrement is a shot proxy. Same weapon required; non-overlapping windows within each episode.
    for i in range(35,len(a)):
        if i-last<35 or weapon[i]!=weapon[i-1] or weapon[i] not in (2,3,4):continue
        if ammo[i-1]-ammo[i] != (2 if weapon[i]==3 else 1):continue
        w=a[i-35:i,4:6]
        if not np.isfinite(w).all():continue
        windows.append(w);ticks.append(i);last=i
    return np.asarray(windows,dtype=np.float32).reshape(-1,35,2),np.asarray(ticks)

"""Persistent, version-bound Optuna studies. Search and replay are separate phases."""
import hashlib
import math
import json
from pathlib import Path
import platform
import sys
import time
import os
import pickle
from importlib.metadata import version
import optuna
from optuna.trial import TrialState


def write(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2)+'\n');temp.replace(path)


def fingerprint(spec):return hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()


class StudyRunner:
    def __init__(self,path,spec,direction,seed=42):
        self.path=Path(path);self.path.mkdir(parents=True,exist_ok=True);self.spec=spec;self.signature=fingerprint(spec)
        protocol=self.path/'protocol.json'
        if protocol.exists() and json.loads(protocol.read_text())!=spec:raise ValueError('Study protocol changed; use a new study name')
        write(protocol,spec)
        self.sampler_path=self.path/'sampler.pkl'
        # The sampler checkpoint is local trusted state, never user-uploaded input.
        sampler=pickle.loads(self.sampler_path.read_bytes()) if self.sampler_path.exists() else optuna.samplers.TPESampler(seed=seed,n_startup_trials=3)
        self.study=optuna.create_study(study_name=spec['model'],storage=f"sqlite:///{self.path/'study.sqlite3'}",load_if_exists=True,direction=direction,sampler=sampler,pruner=optuna.pruners.MedianPruner(n_startup_trials=3,n_warmup_steps=10,interval_steps=5))
        previous=self.study.user_attrs.get('protocol_sha256')
        if previous is not None and previous!=self.signature:raise ValueError('Study database protocol mismatch')
        self.study.set_user_attr('protocol_sha256',self.signature)
        self.study.set_user_attr('environment',{'python':platform.python_version(),'optuna':version('optuna')})

    def export(self):
        rows=[]
        for t in self.study.trials:
            rows.append({'number':t.number,'state':t.state.name,'value':t.value if t.value is None or math.isfinite(t.value) else None,'params':t.params,'attrs':t.user_attrs,'seconds':t.duration.total_seconds() if t.duration else None,'intermediate':{str(k):v for k,v in t.intermediate_values.items() if math.isfinite(v)}})
        write(self.path/'trials.json',rows)
        temporary=self.sampler_path.with_suffix('.tmp');temporary.write_bytes(pickle.dumps(self.study.sampler));temporary.replace(self.sampler_path)
        return rows

    def optimize(self,objective,total_trials,timeout,seeds=()):
        if (self.path/'selection.json').exists():raise ValueError('Study already frozen; start a new version to extend search')
        if not self.study.trials:
            for params in seeds:self.study.enqueue_trial(params)
        def wrapped(trial):
            try:return objective(trial)
            except optuna.TrialPruned:raise
            except Exception as error:
                trial.set_user_attr('failure',f'{type(error).__name__}: {error}')
                raise
        # One worker per study. Timed-out process crashes are explicitly marked failed on resume.
        for trial in self.study.trials:
            if trial.state==TrialState.RUNNING:self.study.tell(trial.number,state=TrialState.FAIL)
        completed=sum(t.state in (TrialState.COMPLETE,TrialState.PRUNED,TrialState.FAIL) for t in self.study.trials)
        self.study.optimize(wrapped,n_trials=max(0,total_trials-completed),timeout=timeout,callbacks=[lambda *_:self.export()],catch=(RuntimeError,ValueError))
        self.export()

    def freeze(self):
        path=self.path/'selection.json'
        if path.exists():return json.loads(path.read_text())
        best=self.study.best_trial
        selection={'trial':best.number,'params':best.params,'value':best.value,'attrs':best.user_attrs,'protocol_sha256':self.signature,'frozen_at':time.time(),'objective':self.spec['objective'],'direction':self.study.direction.name.lower()}
        write(path,selection)
        return selection

    def snapshot(self):
        return {'protocol':self.spec,'selection':self.freeze(),'trials':self.export(),'storage':'local SQLite; single worker; resumable until selection is frozen'}

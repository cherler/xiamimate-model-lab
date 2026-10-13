"""Recommendation adapters: validation-only LambdaRank and LightGCN search."""
import gzip
import json
import pickle
import time
import numpy as np
import optuna
from common import ROOT,load_data,write
from ranking import build_snapshot,make_queries,evaluate,FEATURES


def full_ndcg(prediction,queries):
    scores=[];start=0
    for q in queries:
        n=len(q['ids']);order=np.argsort(-prediction[start:start+n],kind='stable')[:10]
        dcg=np.sum(q['labels'][order]/np.log2(np.arange(len(order))+2));ideal=np.sum(1/np.log2(np.arange(min(10,len(q['target'])))+2))
        scores.append(dcg/ideal if ideal else 0.);start+=n
    return float(np.mean(scores))


def aggregate(windows):
    return {name:{k:float(np.mean([w['models'][name][k] for w in windows])) for k in ['recall','ndcg','hit_rate','catalog_coverage','candidate_recall']} for name in windows[0]['models']}


class RecommendationAdapter:
    def __init__(self,kind,path,config,base,parent):
        self.kind=kind;self.path=path;self.config=config;self.base=base;self.parent=parent;self.cfg=base['recommendation'];self.space=config['search_spaces'][kind]
        data,self.source=load_data();self.data=data[data.date<config['recommendation']['label_end']].copy()
        self.snapshot=build_snapshot(self.data,config['recommendation']['validation_origin'],self.cfg)
        self.queries,self.cohort=make_queries(self.data,self.snapshot,self.cfg)
        self.training=[]
        if kind=='lightgbm':
            for origin in config['recommendation']['training_origins']:
                s=build_snapshot(self.data,origin,self.cfg);queries,_=make_queries(self.data,s,self.cfg);self.training.extend(queries)
        self.objective_name='August next-basket full-target NDCG@10; unseen targets remain in denominator'
        self.direction='maximize'

    def initial(self):
        if self.kind=='lightgbm':return [{'num_leaves':15,'learning_rate':.05,'n_estimators':300,'min_child_samples':30,'reg_lambda':1.,'colsample_bytree':1.}]
        return [{'dimensions':32,'layers':2,'learning_rate':.01,'regularization':.0001,'batch_size':8192},{'dimensions':64,'layers':2,'learning_rate':.002,'regularization':.0001,'batch_size':4096}]

    def objective(self,trial):
        directory=self.path/f'trial-{trial.number:04d}';directory.mkdir(exist_ok=True)
        s=self.space
        if self.kind=='lightgbm':
            params={k:trial.suggest_categorical(k,s[k]) for k in ['num_leaves','n_estimators']}
            params.update(learning_rate=trial.suggest_float('learning_rate',*s['learning_rate'],log=True),min_child_samples=trial.suggest_int('min_child_samples',*s['min_child_samples']),reg_lambda=trial.suggest_float('reg_lambda',*s['reg_lambda'],log=True),colsample_bytree=trial.suggest_float('colsample_bytree',*s['colsample_bytree']))
            model=self.fit_ranker(self.training,params,self.queries,trial)
            iteration=model.best_iteration_ or params['n_estimators'];model.booster_.save_model(str(directory/'model.txt'),num_iteration=iteration)
            prediction=model.booster_.predict(np.vstack([q['features'] for q in self.queries]),num_threads=self.config['threads']);score=full_ndcg(prediction,self.queries)
            trial.set_user_attr('best_epoch',int(iteration));trial.set_user_attr('model_path',str(directory.relative_to(self.path)/'model.txt'))
            return score
        params={k:trial.suggest_categorical(k,s[k]) for k in ['dimensions','layers','batch_size']}
        params.update(learning_rate=trial.suggest_float('learning_rate',*s['learning_rate'],log=True),regularization=trial.suggest_float('regularization',*s['regularization'],log=True))
        result=self.fit_graph(self.snapshot,params,self.config['seed'],s['epochs'],self.queries,trial,directory)
        trial.set_user_attr('best_epoch',result['epoch']);trial.set_user_attr('model_path',str(directory.relative_to(self.path)/'model.pt'));trial.set_user_attr('epochs_run',len(result['trace']))
        return result['score']

    def fit_ranker(self,queries,params,validation=None,trial=None):
        from lightgbm import LGBMRanker,early_stopping
        kwargs=dict(objective='lambdarank',metric='None',random_state=self.config['seed'],n_jobs=self.config['threads'],verbosity=-1,deterministic=True,force_col_wise=True,**params)
        model=LGBMRanker(**kwargs);x=np.vstack([q['features'] for q in queries]);y=np.concatenate([q['labels'] for q in queries]);fit={}
        if validation:
            def metric(y,p):return 'full_ndcg',full_ndcg(p,validation),True
            def prune(env):
                value=next(value for _,name,value,*_ in env.evaluation_result_list if name=='full_ndcg')
                if (env.iteration+1)%10==0:
                    trial.report(value,env.iteration+1)
                    if trial.should_prune():raise optuna.TrialPruned()
            callbacks=[early_stopping(50,first_metric_only=True,verbose=False)]
            if trial:callbacks.append(prune)
            fit=dict(eval_set=[(np.vstack([q['features'] for q in validation]),np.concatenate([q['labels'] for q in validation]))],eval_group=[[len(q['ids']) for q in validation]],eval_metric=metric,callbacks=callbacks)
        model.fit(x,y,group=[len(q['ids']) for q in queries],feature_name=FEATURES,**fit)
        return model

    def fit_graph(self,s,params,seed,epochs,queries=None,trial=None,directory=None):
        import torch
        from graph import LightGCN,normalized_graph,negative_items
        torch.set_num_threads(self.config['threads']);torch.manual_seed(seed);rng=np.random.default_rng(seed)
        x=s['x'];adj=normalized_graph(x);model=LightGCN(*x.shape,params['dimensions'],params['layers']);optimizer=torch.optim.Adam(model.parameters(),lr=params['learning_rate'])
        users,items=x.nonzero();mask=np.asarray(x.sum(axis=1)).ravel()[users]<x.shape[1];users=users[mask];items=items[mask]
        best=-float('inf');best_epoch=0;state=None;trace=[];stale=0
        for epoch in range(1,epochs+1):
            order=rng.permutation(len(users));total=0.
            for start in range(0,len(order),params['batch_size']):
                b=order[start:start+params['batch_size']];u=users[b];p=items[b];n=negative_items(x,u,rng)
                uf,it=model.propagate(adj);pos=(uf[u]*it[p]).sum(-1);neg=(uf[u]*it[n]).sum(-1)
                reg=sum(model.embedding(torch.tensor(z)).square().sum() for z in [u,p+x.shape[0],n+x.shape[0]])/(2*len(b))
                loss=torch.nn.functional.softplus(neg-pos).mean()+params['regularization']*reg
                optimizer.zero_grad();loss.backward();optimizer.step();total+=float(loss.detach())*len(b)
            row={'epoch':epoch,'training_loss':total/len(users)}
            if queries and (epoch%5==0 or epoch==epochs):
                with torch.no_grad():uf,it=model.propagate(adj);uf=uf.numpy();it=it.numpy()
                summary,_=evaluate(s,queries,lambda q:it[q['ids']]@uf[s['ui'][q['customer']]])
                value=summary['ndcg'];row['validation_ndcg']=value
                if value>best+1e-6:best=value;best_epoch=epoch;state={k:v.detach().clone() for k,v in model.state_dict().items()};stale=0
                else:stale+=1
                if trial:
                    trial.report(value,epoch)
                    if trial.should_prune():
                        write(directory/'trace.json',trace+[row]);raise optuna.TrialPruned()
                if stale>=self.space['patience_checks']:trace.append(row);break
            trace.append(row)
        if queries:model.load_state_dict(state)
        else:best_epoch=epochs
        model.eval()
        with torch.no_grad():uf,it=model.propagate(adj);uf=uf.numpy();it=it.numpy()
        if directory:
            torch.save(model.state_dict(),directory/'model.pt');write(directory/'trace.json',trace)
            loaded=LightGCN(*x.shape,params['dimensions'],params['layers']);loaded.load_state_dict(torch.load(directory/'model.pt',weights_only=True))
            with torch.no_grad():u2,i2=loaded.propagate(adj)
            assert max(np.max(np.abs(uf-u2.numpy())),np.max(np.abs(it-i2.numpy())))<1e-7
        return {'model':model,'users':uf,'items':it,'score':best if queries else None,'epoch':best_epoch,'trace':trace}

    def evaluate_selected(self,selection,run):
        from verify import verify_ranking
        oldrank=verify_ranking(self.parent['ranking']);oldgraph=verify_ranking(self.parent['graph']);params=selection['params'];epoch=selection['attrs']['best_epoch']
        samples=json.loads((self.parent['graph']/'samples.json').read_text());windows=[];start=time.perf_counter()
        if self.kind=='lightgbm':
            # Refit June/July/August labels, all ending before the first replay origin.
            model=self.fit_ranker(self.training+self.queries,{**params,'n_estimators':epoch});model.booster_.save_model(str(run/'model.txt'))
        for w in oldrank['windows']:
            origin=w['origin'];print('Replay frozen selection',self.kind,origin,flush=True)
            with gzip.open(self.parent['ranking']/f'snapshot-{origin}.pkl.gz','rb') as f:bundle=pickle.load(f)
            s=bundle['snapshot'];queries=bundle['queries'];rows={};metrics={}
            if self.kind=='lightgbm':
                methods={'lightgbm_tuned':lambda q:model.booster_.predict(q['features'],num_threads=self.config['threads'])}
                for name,scorer in methods.items():metrics[name],rows[name]=evaluate(s,queries,scorer)
            else:
                for seed in [42,43,44]:
                    d=run/f'{origin}-{seed}';d.mkdir();trained=self.fit_graph(s,params,seed,epoch,directory=d);name=f'lightgcn_tuned_{seed}'
                    metrics[name],rows[name]=evaluate(s,queries,lambda q:trained['items'][q['ids']]@trained['users'][s['ui'][q['customer']]])
            byuser={q['customer']:i for i,q in enumerate(queries)}
            for sample in samples:
                if sample['origin']==origin:sample['models'].update({name:records[byuser[sample['customer']]] for name,records in rows.items()})
            write(run/f'predictions-{origin}.json',rows);windows.append({'origin':origin,'models':metrics,'cohort':bundle['cohort'],'catalog':len(s['items'])})
        write(run/'samples.json',samples)
        return {'source':self.source,'task':'next_basket_with_repeat','parent_ranking':oldrank['run_id'],'parent_graph':oldgraph['run_id'],'windows':windows,'aggregate':aggregate(windows),'baseline':{**oldrank['aggregate'],**oldgraph['aggregate']},'sample_model':'lightgbm_tuned' if self.kind=='lightgbm' else 'lightgcn_tuned_42','refit_epochs':epoch,'duration_seconds':time.perf_counter()-start,'limitations':['Search uses August only; September-November replay is already-consumed development data, not an independent test.','Same fixed candidates and returning-user cohort. The graph model still uses only interactions.','Graph epochs chosen on August then refit from each replay origin history; no replay early stopping.']}

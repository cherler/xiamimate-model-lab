"""Fixed-pool ranking ablation and post-hoc diagnostics; April is reused development data."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import numpy as np
import pandas as pd
import lightgbm as lgb
from .dressipi import SessionBaselines, temporal_split, validate_tables
from .dressipi_run import FEATURES, stable_sample, queries, candidate_features
from .m5_data import ROOT, digest, write

CONFIG = Path(__file__).with_name('dressipi-study.json')
STATES = ['not_retrieved', 'rank_after_100', 'rank_11_100', 'rank_1_10']


def summarize(rows, key):
    if not rows:
        return {'sessions': 0, 'retrieved': 0, 'states': dict.fromkeys(STATES, 0),
                'retrieval_recall': None, 'mrr@100': None, 'recall@100': None,
                'recall@10': None, 'conditional_recall@100': None}
    states = dict.fromkeys(STATES, 0); rr = hits = top10 = retrieved = 0
    for row in rows:
        ranking = row['rankings'][key]; target = row['target']; pool = row['pool']
        if len(ranking) > 100 or len(set(ranking)) != len(ranking) or not set(ranking).issubset(pool):
            raise ValueError('invalid ranking or candidate pool')
        found = target in pool; retrieved += found
        rank = ranking.index(target) + 1 if target in ranking else 0
        if rank and not found: raise ValueError('target injected into ranking')
        state = 'not_retrieved' if not found else 'rank_after_100' if not rank else 'rank_11_100' if rank > 10 else 'rank_1_10'
        states[state] += 1; hits += rank > 0; top10 += 0 < rank <= 10; rr += 1 / rank if rank else 0
    n = len(rows)
    return {'sessions': n, 'retrieved': retrieved, 'states': states, 'retrieval_recall': retrieved/n,
            'mrr@100': rr/n, 'recall@100': hits/n, 'recall@10': top10/n,
            'conditional_recall@100': hits/retrieved if retrieved else None}


def bin_label(value, cuts):
    low = 0
    for upper in cuts:
        if value <= upper: return f'{low}–{upper}' if low != upper else str(upper)
        low = upper + 1
    return f'{low}+'


def diagnostic_rows(rows, metadata, cfg):
    lookup = {r['session']: r for r in metadata}
    if len(lookup) != len(rows) or set(lookup) != {r['session'] for r in rows}: raise ValueError('diagnostic cohort mismatch')
    groups = {}
    for field, cuts in cfg['diagnostic_bins'].items():
        labels = (['none', 'partial', 'complete'] if isinstance(cuts, str)
                  else [bin_label(v, cuts) for v in [0, *[x+1 for x in cuts]]])
        buckets = {label: [] for label in labels}
        for row in rows:
            value = lookup[row['session']][field]
            label = value if isinstance(cuts, str) else bin_label(value, cuts)
            buckets[label].append(row)
        groups[field] = [{'group': label, **summarize(subset, 'full')} for label, subset in buckets.items()]
    channels = {}
    for key in ['popularity', 'cooccurrence', 'attributes']:
        hit = sum(r['target'] in r['channels'][key] for r in rows)
        unique = sum(r['target'] in r['channels'][key] and all(r['target'] not in r['channels'][other] for other in ['popularity','cooccurrence','attributes'] if other != key) for r in rows)
        channels[key] = {'hits': hit, 'recall': hit/len(rows), 'unique_hits': unique}
    return {'overall': summarize(rows, 'full'), 'groups': groups, 'channels': channels}


def load_base(root, cfg):
    run = root/'artifacts/competition-runs'/cfg['base_run_id']
    if not run.resolve().is_relative_to((root/'artifacts/competition-runs').resolve()): raise ValueError('invalid base run')
    checks = json.loads((run/'checksums.json').read_text())
    for name, sha in checks.items():
        if Path(name).name != name or digest(run/name) != sha: raise ValueError('base checksum mismatch')
    report = json.loads((run/'report.json').read_text())
    for name, sha in report['code'].items():
        if digest(Path(__file__).with_name(name)) != sha: raise ValueError('base pipeline changed; version a new study')
    return run, report


def run(data_dir):
    started = time.perf_counter(); cfg = json.loads(CONFIG.read_text()); base_run, base_report = load_base(ROOT, cfg)
    base_cfg = base_report['protocol']
    run_id = 'dressipi-study-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = ROOT/'artifacts/competition-runs'/run_id; folder.mkdir(parents=True)
    write(folder/'protocol.json', cfg)
    write(folder/'provenance.json', {'base_run_id': cfg['base_run_id'], 'base_report_sha256': digest(base_run/'report.json'),
          'inputs': base_report['inputs'], 'code_sha256': digest(__file__), 'created_at': datetime.now(timezone.utc).isoformat()})
    for name, sha in base_report['inputs'].items():
        if digest(data_dir/name) != sha: raise ValueError('source data changed')
    views, targets, attrs = [pd.read_csv(data_dir/n, dtype=str) for n in ['train_sessions.csv','train_purchases.csv','item_features.csv']]
    validate_tables(views, targets, attrs)
    base, buy, rankv, rankp = temporal_split(views, targets, base_cfg['base_before'], base_cfg['ranking_before'])
    _, _, validv, validp = temporal_split(views, targets, base_cfg['ranking_before'], base_cfg['validation_end_exclusive'])
    ids = stable_sample(base.session_id, base_cfg['max_base_sessions'])
    base = base[base.session_id.isin(ids)]; buy = buy[buy.session_id.isin(ids)]
    train = queries(rankv, rankp, base_cfg['max_ranking_sessions']); valid = queries(validv, validp, base_cfg['max_validation_sessions'])
    model = SessionBaselines().fit(base, buy, attrs); catalogue = sorted(set(attrs.item_id))
    originals = json.loads((base_run/'predictions.json').read_text())
    if [(s,t) for s,seq,t in valid] != [(r['session'],r['target']) for r in originals]: raise ValueError('validation cohort drift')
    xs=[]; labels=[]; groups=[]; train_records=[]
    for i,(sid,seq,target) in enumerate(train):
        pool,x,_ = candidate_features(model,seq,catalogue)
        train_records.append({'session':sid,'target':target,'pool':pool,'fitted':target in pool})
        if target in pool:
            xs.append(x);labels.extend(int(v==target) for v in pool);groups.append(len(pool))
        if (i+1)%250 == 0: print(f'Cached training {i+1}/{len(train)}',flush=True)
    if len(groups) != base_report['cohort']['ranking_fitted_queries']: raise ValueError('training cohort drift')
    xtrain = np.concatenate(xs); ytrain=np.asarray(labels); del xs
    np.savez_compressed(folder/'training-features.npz',x=xtrain,y=ytrain,groups=groups)
    write(folder/'training-queries.json',train_records)
    valid_x=[]; rows=[]; metadata=[]
    for i,((sid,seq,target),original) in enumerate(zip(valid, originals)):
        pool,x,channels=candidate_features(model,seq,catalogue)
        if pool != original['pool'] or any(channels[k] != original['rankings'][k] for k in channels): raise ValueError('retrieval drift')
        valid_x.append(x);rows.append({'session':sid,'target':target,'pool':pool,'channels':channels,'rankings':{}})
        coverage=sum(bool(model.attributes.get(v)) for v in set(seq))/len(set(seq))
        metadata.append({'session':sid,'session_length':len(seq),'target_purchase_count':model.popularity[target],
                         'last_attribute_count':len(model.attributes[seq[-1]]),
                         'view_attribute_coverage':'none' if coverage==0 else 'complete' if coverage==1 else 'partial'})
        if (i+1)%100==0: print(f'Cached validation {i+1}/{len(valid)}',flush=True)
    np.savez_compressed(folder/'validation-features.npz',x=np.concatenate(valid_x),groups=[len(x) for x in valid_x])
    write(folder/'diagnostic-metadata.json',metadata)
    prep_seconds=time.perf_counter()-started
    write(folder/'frozen.json',{'protocol_sha256':digest(folder/'protocol.json'),
          'training_features_sha256':digest(folder/'training-features.npz'),'validation_features_sha256':digest(folder/'validation-features.npz'),
          'training_queries_sha256':digest(folder/'training-queries.json'),'params':base_cfg['params'],
          'base_model_sha256':digest(base_run/'ranker.txt'),'frozen_at':datetime.now(timezone.utc).isoformat()})
    costs={}; gains={}; full_matches=True
    for name, features in cfg['variants'].items():
        indexes=[FEATURES.index(f) for f in features]; tick=time.perf_counter()
        if name == 'full':
            booster=lgb.Booster(model_file=str(base_run/'ranker.txt')); fit_seconds=None
        else:
            ranker=lgb.LGBMRanker(**base_cfg['params']);ranker.fit(xtrain[:,indexes],ytrain,group=groups,feature_name=features)
            booster=ranker.booster_;fit_seconds=time.perf_counter()-tick
        booster.save_model(str(folder/f'{name}.txt'))
        gains[name]=[{'feature':f,'gain':float(g)} for f,g in zip(features,booster.feature_importance(importance_type='gain'))]
        tick=time.perf_counter()
        for row,x,original in zip(rows,valid_x,originals):
            scores=booster.predict(x[:,indexes],num_threads=2)
            ranking=[row['pool'][j] for j in sorted(range(len(row['pool'])),key=lambda j:(-scores[j],row['pool'][j]))[:100]]
            row['rankings'][name]=ranking
            if name=='full' and ranking != original['rankings']['lightgbm']: full_matches=False
        costs[name]={'fit_seconds':fit_seconds,'predict_seconds':time.perf_counter()-tick,'reused':name=='full'}
        print(f'Evaluated {name}: {summarize(rows,name)}',flush=True)
    if not full_matches: raise ValueError('full model does not reproduce saved rankings')
    write(folder/'predictions.json',rows)
    report={'run_id':run_id,'base_run_id':cfg['base_run_id'],'status':'complete_development_study',
            'public_export_allowed':False,'protocol':cfg,'params':base_cfg['params'],'cohort':base_report['cohort'],
            'models':{k:summarize(rows,k) for k in cfg['variants']},'diagnostics':diagnostic_rows(rows,metadata,cfg),
            'cost':{'preparation_seconds':prep_seconds,'models':costs,'total_seconds':time.perf_counter()-started},
            'feature_gain':gains,'full_rankings_match_base':full_matches}
    write(folder/'report.json',report)
    write(folder/'checksums.json',{p.name:digest(p) for p in folder.iterdir() if p.is_file()})
    verify(folder, base_run)
    write(ROOT/'artifacts/competition-dressipi-study.json',{'run_id':run_id,'report_sha256':digest(folder/'report.json')})
    print(f'Verified {run_id}',flush=True)


def verify(folder, base_run):
    checks=json.loads((folder/'checksums.json').read_text())
    required={'report.json','predictions.json','diagnostic-metadata.json','protocol.json','provenance.json','frozen.json','training-features.npz','training-queries.json','validation-features.npz','behavior.txt','attributes.txt','combined.txt','full.txt'}
    if not required.issubset(checks): raise ValueError('missing study evidence')
    for name,sha in checks.items():
        if Path(name).name!=name or digest(folder/name)!=sha: raise ValueError('study checksum mismatch')
    r=json.loads((folder/'report.json').read_text());cfg=json.loads((folder/'protocol.json').read_text())
    if r['protocol']!=cfg or r['base_run_id']!=base_run.name or r['public_export_allowed'] is not False: raise ValueError('study identity mismatch')
    if json.loads((folder/'provenance.json').read_text())['base_report_sha256']!=digest(base_run/'report.json'): raise ValueError('base report changed')
    rows=json.loads((folder/'predictions.json').read_text()); originals=json.loads((base_run/'predictions.json').read_text())
    if len(rows)!=len(originals) or len({x['session'] for x in rows})!=len(rows): raise ValueError('cohort mismatch')
    for row,original in zip(rows,originals):
        if any(row[k]!=original[k] for k in ['session','target','pool']) or row['rankings']['full']!=original['rankings']['lightgbm']: raise ValueError('baseline changed')
        if any(row['channels'][k]!=original['rankings'][k] for k in row['channels']): raise ValueError('channel changed')
    if r['models']!={k:summarize(rows,k) for k in cfg['variants']}: raise ValueError('metric mismatch')
    if r['diagnostics']!=diagnostic_rows(rows,json.loads((folder/'diagnostic-metadata.json').read_text()),cfg): raise ValueError('diagnostic mismatch')
    return r

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',type=Path,default=ROOT/'data/raw/dressipi');args=parser.parse_args();run(args.data_dir)

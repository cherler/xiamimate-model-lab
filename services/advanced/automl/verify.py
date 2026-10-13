"""Recompute all metrics and enforce cohort identity before selection/export."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from common import ROOT,sha,forecasts_metrics,rank_metrics
from automl.policy import select


def read(path):return json.loads(path.read_text())


def check_metrics(actual,expected):
    for k,v in actual.items():np.testing.assert_allclose(v,expected[k],rtol=1e-10,atol=1e-12)


def ranking_metrics(rows,catalog=None):
    if not rows:raise ValueError('Empty ranking cohort')
    for row in rows:
        assert len(row['ranked'])==len(set(row['ranked']))<=10
        check_metrics(rank_metrics(row['ranked'],set(row['target'])),row)
    result={k:float(np.mean([r[k] for r in rows])) for k in ['recall','ndcg','hit_rate','candidate_recall']}
    if catalog:result['catalog_coverage']=len({i for r in rows for i in r['ranked']})/catalog
    return result


def forecast_metrics(rows):
    if not rows or not all(np.isfinite(r['prediction']) and r['prediction']>=0 for r in rows):raise ValueError('Invalid forecast')
    return forecasts_metrics([r['actual'] for r in rows],[r['prediction'] for r in rows])


def verify_validation(run,rec,forecast):
    spec=read(run/'config.json');cohort=None
    import pickle
    with (run/'recommendation-inputs.pkl').open('rb') as f:bundle=pickle.load(f)
    expected=[(q['customer'],q['target'],len(q['ids'])) for q in bundle['queries']]
    for c in rec:
        if c['state']!='COMPLETE':continue
        rows=read(run/'models'/c['id']/'validation.json');keys=[(r['customer'],r['target'],r['candidate_count']) for r in rows]
        assert keys==expected
        check_metrics(ranking_metrics(rows,len(bundle['snapshot']['items'])),c['metrics']);np.testing.assert_allclose(c['value'],c['metrics']['ndcg'])
    truth=read(run/'forecast-validation-rows.json');keys=lambda rows:[(r['origin'],r['item'],r['date'],r['actual']) for r in rows]
    assert len(truth)==len(spec['config']['validation_origins'])*24*7
    for c in forecast:
        if c['state']!='COMPLETE':continue
        rows=read(run/'models'/('forecast-'+c['id'])/'validation.json');assert keys(rows)==keys(truth)
        check_metrics(forecast_metrics(rows),c['metrics']);np.testing.assert_allclose(c['value'],c['metrics']['wape'])
        if c['id']=='tft':assert c['decoder_target_invariance_max_error']<1e-5
    for c in rec+forecast:
        if c['state']=='COMPLETE':
            assert c['split']=='validation';np.testing.assert_allclose(c['cost_seconds'],c['training_seconds']+c['scoring_seconds'])


def verify_replay(run,report):
    for name,digest in report['selection']['validation_sha256'].items():assert sha(run/name)==digest
    for task,direction in [('recommendation','maximize'),('forecast','minimize')]:
        assert select(report['candidates'][task],direction,report['config']['relative_tolerance'])==report['selection'][task]
        selected={report['selection'][task][k] for k in ['accuracy','efficient']}
        assert set(report['replay'][task])==selected
    for id,data in report['replay']['recommendation'].items():
        for w in data['windows']:
            rows=read(run/f"rec-replay-{id}-{w['origin']}.json");check_metrics(ranking_metrics(rows,w['catalog']),w['metrics'])
        check_metrics({k:float(np.mean([w['metrics'][k] for w in data['windows']])) for k in data['aggregate']},data['aggregate'])
    truth=read(run/'forecast-replay-rows.json');keys=lambda rows:[(r['origin'],r['item'],r['date'],r['actual']) for r in rows]
    assert len(truth)==504
    for id,c in report['replay']['forecast'].items():
        rows=read(run/'models'/('forecast-'+id)/'replay.json');assert keys(rows)==keys(truth);check_metrics(forecast_metrics(rows),c['metrics'])


def verify(run):
    for name,digest in read(run/'checksums.json').items():assert sha(run/name)==digest,name
    r=read(run/'report.json');assert r['selection']==read(run/'selection.json')
    verify_validation(run,r['candidates']['recommendation'],r['candidates']['forecast']);verify_replay(run,r)
    return r

if __name__=='__main__':
    p=read(ROOT/'artifacts/advanced-automl.json');run=ROOT/'artifacts/advanced-runs'/p['run_id'];assert sha(run/'report.json')==p['report_sha256'];verify(run);print('Verified',run.name)

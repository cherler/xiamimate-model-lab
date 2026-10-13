import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {eligibleCandidates,featureComparisons,PIPELINE_NAMES} from '../apps/web/automl-selection.js';
const base=new URL('../apps/web/selection-results/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
const raw=await readFile(new URL(manifest.path,base));assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.sha256);
const report=JSON.parse(raw);
test('pipeline publication preserves validation-only winners and bounded cost preference',()=>{
 assert.equal(report.run_id,manifest.run_id);assert.equal(report.evidence,'development_after_prior_feedback');
 for(const task of ['recommendation','forecast']){
  const rows=report.candidates[task],selection=report.selection[task],complete=rows.filter(r=>r.state==='COMPLETE');
  const quality=r=>selection.direction==='minimize'?r.value:-r.value;
  const best=[...complete].sort((a,b)=>quality(a)-quality(b)||a.id.localeCompare(b.id))[0];assert.equal(best.id,selection.accuracy);
  const eligible=eligibleCandidates(rows,selection.direction,selection.relative_tolerance);assert.deepEqual(eligible.map(r=>r.id),selection.eligible);
  assert.equal([...eligible].sort((a,b)=>a.cost_seconds-b.cost_seconds||quality(a)-quality(b)||a.id.localeCompare(b.id))[0].id,selection.efficient);
  assert.deepEqual(Object.keys(report.replay[task]).sort(),[...new Set([selection.accuracy,selection.efficient])].sort());
  for(const r of rows){assert.ok(PIPELINE_NAMES[r.id]);assert.equal(r.split,'validation');if(r.state==='COMPLETE')assert.ok(Math.abs(r.cost_seconds-r.training_seconds-r.scoring_seconds)<1e-9);}
 }
});
test('feature comparisons use the correct family, task and direction',()=>{
 assert.equal(featureComparisons(report.candidates.recommendation,'recommendation').length,5);
 assert.equal(featureComparisons(report.candidates.forecast,'forecast').length,3);
 for(const task of ['recommendation','forecast']){
  const rows=featureComparisons(report.candidates[task],task),base=rows.find(r=>r.id===(task==='forecast'?'lgbm_history':'rank_behavior'));
  assert.equal(base.delta,0);for(const r of rows)assert.ok(Math.abs(r.delta-(task==='forecast'?base.value-r.value:r.value-base.value))<1e-12);
 }
});
test('failed candidates cannot enter cost eligibility even with an attractive score',()=>{
 const rows=[{id:'a',state:'COMPLETE',value:.3,cost_seconds:10},{id:'b',state:'FAIL',value:1,cost_seconds:0}];
 assert.deepEqual(eligibleCandidates(rows,'maximize',.01).map(r=>r.id),['a']);
});


test('fixed replay baselines stay visible and match the original same-scope evidence',async()=>{
 const oldBase=new URL('../apps/web/advanced-results/',import.meta.url);
 const oldManifest=JSON.parse(await readFile(new URL('manifest.json',oldBase)));
 const ranking=JSON.parse(await readFile(new URL(oldManifest.resources.ranking.path,oldBase)));
 const forecast=JSON.parse(await readFile(new URL(oldManifest.resources.tft.path,oldBase)));
 assert.equal(report.parents.ranking.run,ranking.run_id);
 assert.deepEqual(report.reference_replay.recommendation.decay,ranking.aggregate.decay);
 for(const id of ['last_week','weekday_median'])for(const key of ['wape','mae','bias'])assert.ok(Math.abs(report.reference_replay.forecast[id][key]-forecast.aggregate[id][key])<1e-12);
 // Replay loading is never presented as retraining cost.
 for(const row of Object.values(report.replay.forecast))assert.equal(row.training_seconds,0);
});

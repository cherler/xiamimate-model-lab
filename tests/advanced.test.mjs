import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {recommendationSummary,ADVANCED_NAMES,featureDisplay} from '../apps/web/advanced.js';
const base=new URL('../apps/web/advanced-results/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
const data={};
for(const [key,spec] of Object.entries(manifest.resources)){
 assert.match(spec.path,/^[a-f0-9]{16}\/[a-z-]+\.json$/);
 const bytes=await readFile(new URL(spec.path,base));assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);data[key]=JSON.parse(bytes);
}
test('advanced recommendation comparisons reject mismatched training cohorts',()=>{
 const summary=recommendationSummary(data.ranking,data.graph);
 assert.equal(Object.keys(summary).length,9);
 assert.throws(()=>recommendationSummary(data.ranking,{...data.graph,parent_ranking:'other'}));
 for(const [kind,id] of Object.entries(manifest.runs)){assert.equal(data[kind].run_id,id);assert.equal(data[kind].evidence,'development_after_prior_feedback');}
 for(const [model,metrics] of Object.entries(summary)){
  assert.ok(ADVANCED_NAMES[model]);assert.ok(metrics.recall<=metrics.candidate_recall);
  const windows=model in data.ranking.aggregate?data.ranking.windows:data.graph.windows;
  for(const k of ['recall','ndcg'])assert.ok(Math.abs(metrics[k]-windows.reduce((sum,w)=>sum+w.models[model][k],0)/windows.length)<1e-12);
 }
});
test('every displayed sample has consistent targets, real names, and stored historical feature values',()=>{
 for(const s of data['recommendation-samples']){
  assert.equal(Object.keys(s.models).length,9);
  for(const [model,row] of Object.entries(s.models)){
   assert.deepEqual(row.target,s.target);assert.equal(new Set(row.ranked).size,row.ranked.length);
   assert.ok(Math.abs(row.recall-row.ranked.filter(i=>row.target.includes(i)).length/row.target.length)<1e-12);
   for(const id of row.ranked){assert.ok(s.names[id]);assert.ok(s.features[id]);assert.doesNotMatch(featureDisplay(s.features[id]),/NaN|undefined/);}
   assert.ok(ADVANCED_NAMES[model]);
  }
 }
});
test('forecast page samples reproduce global point errors and interval coverage',()=>{
 const samples=data['forecast-samples'],r=data.tft;assert.equal(samples.length*r.architecture.horizon,r.rows);assert.equal(r.rows,504);
 const actual=samples.flatMap(s=>s.actual),total=actual.reduce((a,b)=>a+b,0);
 for(const [model,metrics] of Object.entries(r.aggregate)){
  const predictions=samples.flatMap(s=>s.predictions[model]);assert.equal(predictions.length,actual.length);assert.ok(predictions.every(Number.isFinite));
  assert.ok(Math.abs(predictions.reduce((sum,p,i)=>sum+Math.abs(p-actual[i]),0)/total-metrics.wape)<1e-12);
 }
 let hits=0;
 for(const s of samples)for(let i=0;i<s.actual.length;i++){
  assert.ok(s.q10[i]<=s.predictions.tft[i]&&s.predictions.tft[i]<=s.q90[i]);
  hits+=Number(s.actual[i]>=s.q10[i]&&s.actual[i]<=s.q90[i]);
 }
 assert.equal(hits/r.rows,r.interval.coverage);assert.equal(r.decoder_target_invariance_max_error,0);assert.ok(!r.architecture.decoder_reals.includes('quantity'));
});

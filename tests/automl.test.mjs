import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tuningComparison,incumbentTrials} from '../apps/web/automl.js';
const base=new URL('../apps/web/tuning-results/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
const data={};
for(const [k,spec] of Object.entries(manifest.resources)){
 assert.match(spec.path,/^[a-f0-9]{16}\/[a-z-]+\.json$/);const raw=await readFile(new URL(spec.path,base));
 assert.equal(createHash('sha256').update(raw).digest('hex'),spec.sha256);data[k]=JSON.parse(raw);
}
test('AutoML chooses only completed validation trials and excludes pruning values from best curve',()=>{
 for(const kind of ['lightgbm','lightgcn','tft']){
  const r=data[kind],s=r.search,chosen=s.selection;assert.equal(r.run_id,manifest.runs[kind]);assert.equal(r.evidence,'development_after_prior_feedback');
  const completed=s.trials.filter(t=>t.state==='COMPLETE');const best=chosen.direction==='minimize'?Math.min(...completed.map(t=>t.value)):Math.max(...completed.map(t=>t.value));
  assert.equal(chosen.value,best);assert.deepEqual(chosen.params,completed.find(t=>t.number===chosen.trial).params);
  const curve=incumbentTrials(s.trials,chosen.direction);assert.equal(curve.length,completed.length);assert.equal(curve.at(-1).best,best);
  const c=tuningComparison(r);assert.equal(c.before,r.baseline[c.old][c.key]);assert.equal(c.after,r.aggregate[r.sample_model][c.key]);
 }
 const trials=[{number:0,state:'COMPLETE',value:5},{number:1,state:'PRUNED',value:100},{number:2,state:'COMPLETE',value:6}];
 assert.deepEqual(incumbentTrials(trials,'maximize').map(t=>t.best),[5,6]);
});
test('tuned recommendation samples retain original targets and reproduce displayed sample recall',()=>{
 assert.equal(data.lightgbm.parent_ranking,data.lightgcn.parent_ranking);
 for(const kind of ['lightgbm','lightgcn'])for(const s of data[`${kind}-samples`]){
  const row=s.models[data[kind].sample_model];assert.deepEqual(row.target,s.target);assert.equal(new Set(row.ranked).size,row.ranked.length);
  assert.equal(row.recall,row.ranked.filter(i=>s.target.includes(i)).length/s.target.length);
 }
});
test('TFT replay samples reproduce before/after WAPE, bias and interval coverage',()=>{
 const r=data.tft,samples=data['tft-samples'],actual=samples.flatMap(s=>s.actual);assert.equal(actual.length,504);const total=actual.reduce((a,b)=>a+b,0);
 for(const name of ['tft','tft_tuned']){
  const pred=samples.flatMap(s=>s.predictions[name]);assert.ok(pred.every(Number.isFinite));
  assert.ok(Math.abs(pred.reduce((s,p,i)=>s+Math.abs(p-actual[i]),0)/total-r.aggregate[name].wape)<1e-12);
  assert.ok(Math.abs((pred.reduce((s,p)=>s+p,0)-total)/total-r.aggregate[name].bias)<1e-12);
 }
 let covered=0;for(const s of samples)for(let i=0;i<7;i++){
  assert.ok(s.tuned_q10[i]<=s.predictions.tft_tuned[i]&&s.predictions.tft_tuned[i]<=s.tuned_q90[i]);
  covered+=Number(s.actual[i]>=s.tuned_q10[i]&&s.actual[i]<=s.tuned_q90[i]);
 }
 assert.equal(covered/504,r.interval.coverage);
});

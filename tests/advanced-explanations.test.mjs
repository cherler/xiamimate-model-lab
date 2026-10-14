import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateExplanations,contributionTable} from '../apps/web/advanced-explanations.js';
const root=new URL('../apps/web/advanced-results/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root)));
const loaded=Object.fromEntries(await Promise.all(Object.entries(manifest.resources).map(async([k,v])=>[k,JSON.parse(await readFile(new URL(v.path,root)))])));
test('explanations are bound to exact frozen report hashes',()=>{
 validateExplanations(loaded,manifest);
 const payload=loaded['explanation-trees'];assert.ok(payload);
 assert.throws(()=>validateExplanations({...loaded,'explanation-trees':{...payload,reports:{...payload.reports,ranking:'wrong'}}},manifest));
});
test('every LightGBM sample reconstructs the shown score and all feature groups',()=>{
 const data=loaded['explanation-trees'].data;
 assert.equal(data.recommendation.length,loaded['recommendation-samples'].length);
 for(const s of data.recommendation)for(const [model,r] of Object.entries(s.models)){
  const sample=loaded['recommendation-samples'].find(x=>x.origin===s.origin&&x.customer===s.customer);
  assert.deepEqual(Object.entries(r.items).sort((a,b)=>a[1].rank-b[1].rank).slice(0,10).map(([id])=>id),sample.models[model].ranked);
  for(const row of Object.values(r.items)){
   assert.equal(row.contributions.length,r.features.length);
   assert.ok(Math.abs(row.base+row.contributions.reduce((a,b)=>a+b,0)-row.score)<1e-7);
   assert.doesNotMatch(contributionTable(r.features,row,'分'),/NaN|undefined/);
  }
 }
 assert.equal(data.forecast.length,72);
 for(const s of data.forecast){const sample=loaded['forecast-samples'].find(x=>x.origin===s.origin&&x.item===s.item);s.days.forEach((d,i)=>{
  assert.ok(Math.abs(d.base+d.contributions.reduce((a,b)=>a+b,0)-d.score)<1e-7);
  assert.ok(Math.abs(Math.max(0,d.score)-sample.predictions.lightgbm[i])<1e-7);
 });}
});

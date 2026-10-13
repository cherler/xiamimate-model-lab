import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {CASE_INFO} from '../apps/web/case-info.js';
import {CASES,resolveRoute} from '../apps/web/case-navigation.js';
import {M5_LEVELS,featureShares,featureMeaning,relativeImprovement} from '../apps/web/m5-details.js';
test('every selectable task and case has a usable data explanation route',()=>{
 for(const [task,cases] of Object.entries(CASES))for(const c of cases){
  assert.ok(c.views.includes('data'));
  const info=CASE_INFO[c.id];assert.equal(info.tasks[task].length,6);assert.ok(info.fields.length>=3);
  assert.ok(new URL(info.url).protocol==='https:');
  assert.equal(resolveRoute(`#${task}?case=${c.id}&view=data`).params.get('view'),'data');
 }
 for(const view of ['models','report','training'])assert.equal(resolveRoute(`#forecast?case=m5&view=${view}`).params.get('view'),view);
});
test('training gain shares normalize across all features without mutating input or dividing by zero',()=>{
 const data=[{feature:'a',gain:1},{feature:'b',gain:3}];
 assert.deepEqual(featureShares(data).map(f=>[f.feature,f.share]),[['b',.75],['a',.25]]);
 assert.equal(data[0].feature,'a');assert.equal(featureShares([{feature:'a',gain:0}])[0].share,0);
 assert.throws(()=>featureShares([{feature:'bad',gain:-1}]));
 assert.equal(relativeImprovement(2,4),.5);assert.equal(relativeImprovement(5,4),-.25);assert.equal(relativeImprovement(0,0),null);
});
const path='apps/web/m5-results/manifest.json';
test('saved M5 details cover all actual features, preserve trained gains and reproduce the 12-level score',{skip:!existsSync(path)},()=>{
 const manifest=JSON.parse(readFileSync(path));const o=JSON.parse(readFileSync(`apps/web/m5-results/${manifest.resources.overview.path}`));
 const report=JSON.parse(readFileSync(`artifacts/competition-runs/${o.run_id}/report.json`));
 assert.equal(M5_LEVELS.length,12);
 o.windows.forEach((w,i)=>{
  const original=[...report.folds,report.final][i];
  assert.deepEqual(w.cost,original.cost);assert.equal(w.cost.feature_gain.length,42);
  for(const f of w.cost.feature_gain)assert.notEqual(featureMeaning(f.feature)[0],'未定义',f.feature);
  assert.ok(Math.abs(featureShares(w.cost.feature_gain).reduce((s,f)=>s+f.share,0)-1)<1e-12);
  for(const m of Object.values(w.models))assert.ok(Math.abs(m.by_level.reduce((s,v)=>s+v,0)/12-m.scope_wrmsse)<1e-12);
 });
});

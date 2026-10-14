import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {forecastPair,recommendationOverlap} from '../apps/web/public-comparison.js';
const read=p=>JSON.parse(fs.readFileSync(p));
test('forecast pair calculates atomic errors, zero denominators and invalid input',()=>{
 const rows=[{actual:[0,10],predictions:{a:[5,5],b:[0,10]}}];
 const c=forecastPair(rows,'a','b');assert.equal(c.error,10);assert.equal(c.gain,-10);assert.equal(c.bias,0);assert.equal(c.relative,null);assert.equal(c.wape,1);
 assert.equal(forecastPair([{actual:0,predictions:{a:2,b:0}}],'a','b').wape,null);
 assert.throws(()=>forecastPair([{actual:[0,1],predictions:{a:[0],b:[0,1]}}],'a','b'));
 assert.throws(()=>forecastPair([],'a','b'));
});
test('all saved public forecast pair totals reconcile with frozen report metrics',()=>{
 const manifest=read('apps/web/showcase/manifest.json'),entry=manifest.cases.find(c=>c.id==='tafeng');
 const tf=read(`apps/web/showcase/${entry.resources.weekly}`),tr=read(`apps/web/showcase/${entry.resources.report}`);
 const tasks=[{rows:tf.series,models:tr.weekly}];
 if(fs.existsSync('apps/web/uci-results/manifest.json')){
  const m=read('apps/web/uci-results/manifest.json'),root=`apps/web/uci-results/${m.version}/`,r=read(root+'report.json');
  tasks.push({rows:read(root+'forecast-series.json'),models:r.forecast.models},{rows:read(root+'weekly-series.json'),models:r.weekly.models});
 }
 for(const {rows,models} of tasks)for(const a of Object.keys(models))for(const b of Object.keys(models)){
  const c=forecastPair(rows,a,b);assert.ok(Math.abs(c.wape-models[a].metrics.wape)<1e-9,`${a} WAPE`);assert.ok(Math.abs(c.baseWape-models[b].metrics.wape)<1e-9,`${b} WAPE`);
  assert.equal(c.counts.improved+c.counts.tied+c.counts.worse,c.n);
  const sub=[...new Set(rows.map(r=>r.origin))].map(o=>forecastPair(rows.filter(r=>r.origin===o),a,b));assert.ok(Math.abs(sub.reduce((n,v)=>n+v.gain,0)-c.gain)<1e-7);
  if(a===b){assert.equal(c.gain,0);assert.equal(c.counts.tied,c.n);}
 }
});
test('recommendation overlap is list change, with strict same-sample boundaries',()=>{
 const a={run_id:'x',customer_id:'1',as_of:'2011-11-01',items:[{id:'a'},{id:'b'}]},b={...a,items:[{id:'b'},{id:'c'}]};
 assert.deepEqual(recommendationOverlap(a,b),{common:1,added:1,removed:1});assert.throws(()=>recommendationOverlap(a,{...b,customer_id:'2'}));
 assert.deepEqual(recommendationOverlap(a,a),{common:2,added:0,removed:0});
});

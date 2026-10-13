import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sampleStatus,forecastRow,MODEL_NAMES} from '../apps/web/showcase.js';
const base=new URL('../apps/web/showcase/',import.meta.url);
let manifest;
try { manifest=JSON.parse(await readFile(new URL('manifest.json',base))); } catch(e) { if(e.code!=='ENOENT') throw e; }
const load=async path=>JSON.parse(await readFile(new URL(path,base)));

test('cold repurchase and unobserved returns cannot become scored examples',()=>{
  assert.equal(sampleStatus({cohort:'cold',tasks:{repurchase:{m:{ndcg:0}}}},'repurchase','m'),'inapplicable');
  assert.equal(sampleStatus({cohort:'warm',tasks:{}},'repurchase','m'),'unobserved');
  assert.equal(sampleStatus({cohort:'warm',tasks:{repurchase:{m:{target:[]}}}},'repurchase','m'),'scored');
  assert.throws(()=>forecastRow({series:[]},'missing','2001-02-01'),/没有已核验结果/);
});
test('exported files all match version manifest; different evidence levels stay separate',{skip:!manifest},async()=>{
  assert.deepEqual(manifest.cases.map(c=>[c.id,c.evidence]),[['tafeng','final_holdout'],['uci','development']]);
  for(const [path,hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(await readFile(new URL(path,base))).digest('hex'),hash,path);
});
test('forecast export covers all 50 products and four origins with six methods; metrics recompute',{skip:!manifest},async()=>{
  const entry=manifest.cases.find(c=>c.id==='tafeng');const data=await load(entry.resources.weekly),report=await load(entry.resources.report);
  assert.equal(data.items.length,50);assert.equal(data.origins.length,4);assert.equal(data.series.length,200);
  for(const item of data.items) for(const origin of data.origins) {
    const row=forecastRow(data,item,origin); assert.equal(row.past_weeks.length,4);
    assert.deepEqual(Object.keys(row.predictions),Object.keys(report.weekly));
    for(const value of [row.actual,...row.past_weeks,...Object.values(row.predictions)]) assert.ok(Number.isFinite(value)&&value>=0);
  }
  for(const [name,v] of Object.entries(report.weekly)) {
    assert.ok(MODEL_NAMES[name]); const actual=data.series.reduce((s,r)=>s+r.actual,0);
    const abs=data.series.reduce((s,r)=>s+Math.abs(r.predictions[name]-r.actual),0);
    const bias=data.series.reduce((s,r)=>s+r.predictions[name]-r.actual,0);
    assert.ok(Math.abs(abs/actual-v.metrics.wape)<1e-12);assert.ok(Math.abs(bias/actual-v.metrics.bias)<1e-12);
  }
  assert.ok(data.series.some(r=>r.actual===0),'zero-sales cases must not be removed');
});
test('sample outputs preserve fixed top 10, history exclusion, OOV targets and no-return examples',{skip:!manifest},async()=>{
  const entry=manifest.cases.find(c=>c.id==='tafeng'), data=await load(entry.resources.recommendations);
  assert.equal(data.samples.filter(s=>s.cohort==='warm').length,24);assert.equal(data.samples.filter(s=>s.cohort==='cold').length,3);
  assert.ok(data.samples.some(s=>!Object.keys(s.tasks).length));
  let short=false;
  for(const sample of data.samples) for(const [task,models] of Object.entries(sample.tasks)) for(const [name,row] of Object.entries(models)) {
    assert.ok(MODEL_NAMES[name]);assert.ok(row.ranked.length<=10);assert.equal(row.ranked.length,new Set(row.ranked).size);
    assert.ok(row.ranked.every(id=>task==='repurchase'?sample.history.includes(id):!sample.history.includes(id)));
    const hits=row.ranked.filter(id=>row.target.includes(id)).length;
    assert.equal(row.precision,hits/10);assert.equal(row.recall,row.target.length?hits/row.target.length:null);
    if(row.candidate_count<10) { short=true;assert.equal(row.ranked.length,row.candidate_count); }
  }
  assert.ok(short);
});

const {sortedHistory,exampleComparison}=await import('../apps/web/showcase.js');
const {productLabel,productNameHtml,TRANSLATIONS}=await import('../apps/web/product-labels.js');
test('history order keeps unavailable metadata last and never mutates saved IDs',()=>{
 const sample={history:['missing','recent','frequent'],behavior:{recent:{days_since_last:2,purchase_days:1},frequent:{days_since_last:8,purchase_days:3},missing:null}};
 assert.deepEqual(sortedHistory(sample),['recent','frequent','missing']);
 assert.deepEqual(sortedHistory(sample,'frequency'),['frequent','recent','missing']);
 assert.deepEqual(sample.history,['missing','recent','frequent']);
});
test('individual comparison reports ties, regressions, missed targets and undefined rows',()=>{
 const baseline={ranked:['a','x'],target:['a','b'],ndcg:.5};
 assert.deepEqual(exampleComparison({...baseline,ranked:['a','y']},baseline),{currentHits:1,baselineHits:1,targets:2,ndcgDifference:0,missed:['b']});
 assert.equal(exampleComparison({...baseline,ranked:['x'],ndcg:0},baseline).ndcgDifference,-.5);
 assert.equal(exampleComparison(null,baseline),null);
});
test('exported behavior reproduces the screenshot example without changing rankings',{skip:!manifest},async()=>{
 const entry=manifest.cases.find(c=>c.id==='tafeng'),data=await load(entry.resources.recommendations);
 const sample=data.samples.find(s=>s.customer==='00930574');
 assert.deepEqual(sample.behavior['87108026'],{purchase_days:2,days_since_last:32,last_purchase_date:'2000-12-31'});
 const baseline=sample.tasks.repurchase.personal_decay_90d,current=sample.tasks.repurchase.als_decay_25;
 const result=exampleComparison(current,baseline);
 assert.equal(result.currentHits,1);assert.equal(result.baselineHits,1);assert.equal(result.targets,2);assert.equal(result.ndcgDifference,0);
 for(const s of data.samples) for(const [item,b] of Object.entries(s.behavior)) {
  assert.ok(s.history.includes(item));if(!b)continue;
  assert.ok(b.purchase_days>0 && b.days_since_last>0);
  assert.ok(b.last_purchase_date < data.origin);
  assert.equal((Date.parse(data.origin)-Date.parse(b.last_purchase_date))/86400000,b.days_since_last);
 }
});
test('reference translations preserve original descriptions and safely fall back',()=>{
 assert.equal(productLabel(' IVORY HANGING DECORATION  BIRD '),'象牙白小鸟挂饰');
 assert.ok(productNameHtml('BIRD DECORATION GREEN POLKADOT').includes('原文 BIRD DECORATION GREEN POLKADOT'));
 assert.ok(productNameHtml('<untranslated>').includes('&lt;untranslated&gt;'));
 assert.equal(productLabel('UNKNOWN PRODUCT'),'UNKNOWN PRODUCT');
 assert.ok(Object.keys(TRANSLATIONS).length>=140);
});
test('display v2 preserves all previous scored rows and forecast outputs',{skip:!manifest},async()=>{
 const currentEntry=manifest.cases.find(c=>c.id==='tafeng');
 let previous;
 try { previous=await load(`${currentEntry.run_id}/recommendations.json`); } catch(e) { if(e.code==='ENOENT') return;throw e; }
 const current=await load(currentEntry.resources.recommendations);
 assert.deepEqual(current.samples.map(({behavior,...sample})=>sample),previous.samples);
 const oldWeekly=await load(`${currentEntry.run_id}/weekly.json`),newWeekly=await load(currentEntry.resources.weekly);
 assert.deepEqual(newWeekly,oldWeekly);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rankingCalculation,forecastCalculation,verifyLessonResults,renderMetricLessons} from '../apps/web/metric-lessons.js';
import {BUSINESS_CONTRACTS,businessContractHtml} from '../apps/web/case-business.js';
import {CASES} from '../apps/web/case-navigation.js';

test('rank discounts, fixed precision denominator and absent catalog targets remain separate',()=>{
 const row={ranked:['x','a'],target:['a','outside_catalog']},c=rankingCalculation(row);
 assert.equal(c.hits,1);assert.equal(c.recall,.5);assert.equal(c.precision,.1);
 assert.equal(c.dcg,1/Math.log2(3));assert.equal(c.idcg,1+1/Math.log2(3));
 assert.equal(c.ndcg,c.dcg/c.idcg);
 assert.equal(rankingCalculation(row,1).ndcg,0);
 assert.equal(rankingCalculation(row,3).precision,1/3);
 assert.equal(row.ranked.length,2);
 assert.throws(()=>rankingCalculation(row,11));
 assert.throws(()=>rankingCalculation({ranked:['a','a'],target:['a']}));
});
test('empty task targets have undefined recall and zero NDCG',()=>{
 const c=rankingCalculation({ranked:['a'],target:[]});
 assert.equal(c.recall,null);assert.equal(c.ndcg,0);assert.equal(c.precision,0);
 assert.equal(rankingCalculation({ranked:[],target:['a']}).recall,0);
});
test('WAPE sums absolute errors including zero-sales rows; bias may cancel',()=>{
 const rows=[{actual:10,predictions:{m:20}},{actual:90,predictions:{m:70}},{actual:0,predictions:{m:10}}];
 const c=forecastCalculation(rows,'m');
 assert.equal(c.wape,.4);assert.equal(c.mae,40/3);assert.equal(c.bias,0);assert.equal(c.count,3);
 const zero=forecastCalculation([{actual:0,predictions:{m:4}}],'m');
 assert.equal(zero.wape,null);assert.equal(zero.bias,null);assert.equal(zero.mae,4);
 assert.throws(()=>forecastCalculation([],'m'));
 assert.throws(()=>forecastCalculation(rows,'missing'));
});
test('every routed case/task has a distinct business contract and an existing lesson link',()=>{
 for(const [task,cases] of Object.entries(CASES))for(const c of cases){
  assert.ok(BUSINESS_CONTRACTS[`${c.id}:${task}`]);
  assert.ok(businessContractHtml(c.id,task).includes(`#learn?lesson=${task}`));
 }
 assert.throws(()=>businessContractHtml('unknown','forecast'));
});
const root=new URL('../apps/web/showcase/',import.meta.url);
let manifest;try{manifest=JSON.parse(await readFile(new URL('manifest.json',root)));}catch(e){if(e.code!=='ENOENT')throw e;}
test('all saved teaching rows match original metrics; modified metrics and versions fail closed',{skip:!manifest},async()=>{
 const entry=manifest.cases.find(c=>c.id==='tafeng');
 const [rec,weekly,report]=await Promise.all(['recommendations','weekly','report'].map(k=>readFile(new URL(entry.resources[k],root),'utf8').then(JSON.parse)));
 verifyLessonResults(rec,weekly,report);
 const changed=structuredClone(report);changed.weekly.last_week.metrics.wape+=.01;
 assert.throws(()=>verifyLessonResults(rec,weekly,changed),/不一致/);
 assert.throws(()=>verifyLessonResults({...rec,run_id:'different'},weekly,report),/版本/);
 const broken=structuredClone(rec);broken.samples[0].tasks.repurchase.personal_frequency.ndcg+=.01;
 assert.throws(()=>verifyLessonResults(broken,weekly,report),/不一致/);
});
test('missing saved resources show an error, and a stale lesson cannot overwrite another route',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('offline');};
 try{
  const host={innerHTML:''};await renderMetricLessons(host,()=>true);assert.match(host.innerHTML,/教学结果暂不可用/);
  let content='';const stale={get innerHTML(){return content;},set innerHTML(v){content=v;}};
  const pending=renderMetricLessons(stale,()=>false);content='another route';await pending;assert.equal(content,'another route');
 }finally{globalThis.fetch=original;}
});

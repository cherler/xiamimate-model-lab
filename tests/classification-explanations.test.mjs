import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyClassificationExplanations,sampleExplanationHtml} from '../apps/web/classification-explanations.js';
import {applyPolicy} from '../apps/web/classification-metrics.js';
const read=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url)));
const m=read('apps/web/classification-results/manifest.json'),parent=read('apps/web/classification-results/'+m.path);
const em=read('apps/web/classification-explanations/manifest.json'),e=read('apps/web/classification-explanations/'+em.path);
const state={split:'test',model:'lightgbm',baseline:'logistic',threshold:parent.report.thresholds.lightgbm,baseThreshold:parent.report.thresholds.logistic,mode:'threshold',share:.2};
test('both published partitions reconstruct original raw and calibrated scores from local contributions',()=>{
 assert.equal(verifyClassificationExplanations(e,parent,m.sha256),e);
 assert.equal(Object.keys(e.rows.test).length,647);assert.equal(Object.keys(e.rows.validation).length,429);
 assert.ok(e.max_additivity_error<1e-10);
});
test('reject source swaps, reordered features, missing rows, corrupted contributions and calibration',()=>{
 const id=parent.rows.test[0].id;
 const mutations=[x=>x.parent_sha256='wrong',x=>x.model_sha256='wrong',x=>x.run_id='wrong',x=>x.features.reverse(),x=>delete x.rows.test[id],x=>x.rows.test.extra=x.rows.test[id],x=>x.rows.test[id].lightgbm.contributions[0]+=.01,x=>x.rows.test[id].logistic.base+=.01,x=>x.rows.test[id].lightgbm.margin+=.01,x=>x.calibrators.lightgbm.slope+=.1,x=>x.rows.test[id].logistic.contributions.pop(),x=>x.rows.test[id].lightgbm.contributions[0]=NaN];
 for(const mutate of mutations){const copy=structuredClone(e);mutate(copy);assert.throws(()=>verifyClassificationExplanations(copy,parent,m.sha256),/分类解释校验失败/);}
});
test('explanations show failures, both contribution directions and model-specific references',()=>{
 const selected=applyPolicy(parent.rows.test,'lightgbm',state);
 for(const wanted of [true,false]){
  const row=parent.rows.test.find(r=>(selected.has(r.id)!==Boolean(r.label))===wanted);
  const html=sampleExplanationHtml(parent,e,row,state);
  assert.match(html,wanted?/本条判定与真实标签不符/:/本条判定与真实标签一致/);
  for(const phrase of ['推高垃圾评分','压低垃圾评分','不是概率百分点','TreeSHAP','不是 SHAP','不是因果']){
   if(phrase==='不是因果')assert.match(html,/不证明某词导致/);else assert.ok(html.includes(phrase),phrase);
  }
  assert.match(html,/真实标签未参与本条打分/);
 }
});
test('threshold and capacity decisions use current policy including zero/full quotas and ties',()=>{
 const row=parent.rows.test[0];
 for(const share of [0,1]){
  const html=sampleExplanationHtml(parent,e,row,{...state,mode:'capacity',share});
  assert.equal((html.match(/<h4>进入待复核队列/g)||[]).length,share?2:0);
  assert.match(html,new RegExp(`本次取前 ${Math.floor(647*share)} 条`));
 }
 const html=sampleExplanationHtml(parent,e,row,{...state,threshold:1.000001,baseThreshold:1.000001});
 assert.equal((html.match(/<h4>不进入待复核队列/g)||[]).length,2);
 const exact=sampleExplanationHtml(parent,e,row,{...state,threshold:row.scores.lightgbm});
 assert.match(exact,/>进入待复核队列<\/h4>/);
});
test('rule baseline exposes actual trigger ratio; unavailable explanation is explicit',()=>{
 const html=sampleExplanationHtml(parent,e,parent.rows.test[0],{...state,baseline:'rules',baseThreshold:parent.report.thresholds.rules});
 assert.match(html,/四项固定条件触发/);assert.match(html,/规则输入/);assert.match(html,/原始分数/);
 assert.match(sampleExplanationHtml(parent,null,parent.rows.test[0],state),/逐样本贡献暂不可用/);
});
test('loader rejects missing or corrupted bytes and retries without substituting explanations',async()=>{
 const {loadClassificationExplanations}=await import('../apps/web/classification-explanations.js');
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>new Response('missing',{status:404});
  await assert.rejects(loadClassificationExplanations(parent,m),/尚未导出/);
  globalThis.fetch=async url=>String(url).endsWith('manifest.json')?Response.json(em):new Response('{}');
  await assert.rejects(loadClassificationExplanations(parent,m),/哈希不匹配/);
  globalThis.fetch=async url=>{calls++;return String(url).endsWith('manifest.json')?Response.json(em):new Response(fs.readFileSync(new URL('../apps/web/classification-explanations/'+em.path,import.meta.url)));};
  assert.equal((await loadClassificationExplanations(parent,m)).run_id,parent.run_id);
  await loadClassificationExplanations(parent,m);assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});

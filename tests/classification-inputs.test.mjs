import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyInputs,inputPair,equalInputs,INPUT_VARIANTS,INPUT_MODELS} from '../apps/web/classification-input-metrics.js';
import {inputStudyHtml,inputEntry,loadInputs} from '../apps/web/classification-inputs.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
import {sectionHref} from '../apps/web/navigation-state.js';
import {caseReading,caseExercise} from '../apps/web/case-reading.js';
const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url))),dir='apps/web/classification-input-results/';
const manifest=read(dir+'manifest.json'),p=read(dir+manifest.path),old=read('apps/web/classification-results/manifest.json'),parent=read('apps/web/classification-results/'+old.path),study={data:p,manifest};
test('all ten input arms recompute scores, calibration, fixed thresholds and paired queue changes',()=>{
 assert.equal(verifyInputs(p,parent),p);
 const pair=inputPair(p.rows,'all:lightgbm','all:logistic',.2);
 assert.equal(pair.a.selected,85);assert.equal(pair.a.tp-pair.b.tp,3);
 assert.equal(pair.changes.corrected_fn.length,16);assert.equal(pair.changes.new_fn.length,13);
 const only=inputPair(p.rows,'all:lightgbm','words_only:lightgbm',.2);assert.equal(only.a.tp-only.b.tp,-1);
});
test('reject tampered scores, parent membership, counts, uncertainty and missing arms',()=>{
 const mutations=[x=>x.rows[0].scores['all:logistic']=NaN,x=>x.rows[0].label=1-x.rows[0].label,x=>x.rows.push(x.rows[0]),x=>x.access.test_opened=true,x=>delete x.result.models['no_words:logistic'],x=>x.result.pairs.pop(),x=>x.result.models['all:lightgbm'].capacity['0.2'].fp++,x=>x.thresholds['all:lightgbm']+=.01,x=>x.result.pairs[0].intervals.ap_gain=[1,-1],x=>x.rows[0].group='0'.repeat(64)];
 for(const mutate of mutations){const q=structuredClone(p);mutate(q);assert.throws(()=>verifyInputs(q,parent));}
 assert.throws(()=>equalInputs(NaN,NaN));
});
test('all model, contrast and quota controls show both gains and limitations; reverse model comparison works',()=>{
 for(const model of Object.keys(INPUT_MODELS))for(const contrast of [...Object.keys(INPUT_VARIANTS).filter(v=>v!=='all'),'algorithm'])for(const share of [.1,.2,.3]){
  const html=inputStudyHtml(study,{inputModel:model,inputContrast:contrast,inputShare:share});
  assert.ok(html.includes(`同样复核 ${Math.floor(429*share)} 条`));
  for(const phrase of ['429 条已知开发验证','原留出','不包含重新训练的不确定性','全部十组实验','丢失对照原来能找回','没有测量采集费用'])assert.ok(html.includes(phrase),phrase);
 }
 assert.match(inputEntry(true),/贡献与输入价值/);
});
test('input view survives route normalization and top-level round-trip without claiming old test evidence',()=>{
 const params=resolveRoute('#classify?case=spambase&view=inputs&inputContrast=words_only').params;
 assert.equal(params.get('view'),'inputs');
 const href=sectionHref('models','classify',params),back=sectionHref('case','classify',new URLSearchParams(href.split('?')[1]));assert.match(back,/view=inputs/);
 assert.match(caseReading('classify',params).scope,/429 条已知开发验证/);
 assert.match(caseExercise('classify',params).metric,/消融/);
});
test('loader fails closed on missing or corrupt exports then loads genuine static evidence',async()=>{
 const saved=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('',{status:404});await assert.rejects(loadInputs(parent),/尚未导出/);
  globalThis.fetch=async url=>String(url).endsWith('manifest.json')?Response.json(manifest):new Response('{}');await assert.rejects(loadInputs(parent),/校验失败/);
  globalThis.fetch=async url=>String(url).endsWith('manifest.json')?Response.json(manifest):new Response(fs.readFileSync(new URL('../'+dir+manifest.path,import.meta.url)));
  assert.equal((await loadInputs(parent)).data.run_id,p.run_id);
 }finally{globalThis.fetch=saved;}
});

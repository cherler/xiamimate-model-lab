import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {applyPolicy,confusionCounts,scoreMetrics,verifyClassification} from '../apps/web/classification-metrics.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
const rows=[{id:'a',source_row:1,group:'a',label:1,scores:{rules:.8}},{id:'b',source_row:2,group:'b',label:0,scores:{rules:.8}},{id:'c',source_row:3,group:'c',label:1,scores:{rules:.5}},{id:'d',source_row:4,group:'d',label:0,scores:{rules:.1}}];
test('capacity uses exact floor counts and label-blind deterministic ties',()=>{
 assert.deepEqual([...applyPolicy(rows,'rules',{mode:'capacity',share:.25})],['a']);
 assert.deepEqual([...applyPolicy([...rows].reverse(),'rules',{mode:'capacity',share:.5})],['a','b']);
 assert.equal(applyPolicy(rows,'rules',{mode:'capacity',share:0}).size,0);
 assert.equal(applyPolicy(rows,'rules',{mode:'capacity',share:1}).size,4);
 assert.deepEqual([...applyPolicy(rows.map(r=>({...r,label:1-r.label})),'rules',{mode:'capacity',share:.25})],['a']);
});
test('threshold includes equality and confusion denominators stay distinct',()=>{
 const c=confusionCounts(rows,applyPolicy(rows,'rules',{threshold:.8}));
 assert.deepEqual(c,{tp:1,fp:1,fn:1,tn:1,selected:2,precision:.5,recall:.5,fpr:.5});
 assert.equal(confusionCounts(rows,new Set()).precision,null);
 assert.throws(()=>applyPolicy(rows,'rules',{threshold:NaN}));
 assert.throws(()=>applyPolicy(rows,'rules',{mode:'capacity',share:1.1}));
});
test('AP groups tied scores together; ROC includes half-credit for ties',()=>{
 const m=scoreMetrics(rows,'rules');
 assert.ok(Math.abs(m.ap-(.5*.5+.5*2/3))<1e-12);
 assert.equal(m.roc_auc,.625);assert.equal(m.bins.reduce((s,b)=>s+b.n,0),4);
 assert.equal(m.bins[8].n,2);assert.equal(m.bins[8].positive_rate,.5);
});
test('classification links canonicalize views without changing old cases',()=>{
 const r=resolveRoute('#classify');assert.equal(r.params.get('case'),'spambase');assert.equal(r.params.get('view'),'experience');
 assert.equal(resolveRoute('#classify?view=models').params.get('view'),'models');
 assert.equal(resolveRoute('#classify?view=bad').params.get('view'),'experience');
 assert.equal(resolveRoute('#classify?case=unknown').params.get('case'),'unknown');
});
let manifest;const base=new URL('../apps/web/classification-results/',import.meta.url);
try{manifest=JSON.parse(await readFile(new URL('manifest.json',base)));}catch(e){if(e.code!=='ENOENT')throw e;}
test('export hash and every saved metric match; edited scores fail verification',{skip:!manifest},async()=>{
 const bytes=await readFile(new URL(manifest.path,base));assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
 const payload=JSON.parse(bytes);verifyClassification(payload);
 const copy=structuredClone(payload);copy.rows.test[0].scores.lightgbm=.2;
 assert.throws(()=>verifyClassification(copy));
 const overlap=structuredClone(payload);overlap.rows.test[0].group=overlap.rows.validation[0].group;assert.throws(()=>verifyClassification(overlap),/分区/);
 assert.ok(!payload.report.features.includes('word_freq_george'));assert.equal(payload.report.features.length,53);
});

test('missing classification export reports an error and stale routes are not overwritten',async()=>{
 const {renderClassification}=await import('../apps/web/classification.js');
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('missing export');};
 try{
  const host={innerHTML:''};await renderClassification(host,()=>true,new URLSearchParams('case=spambase&view=report'));assert.match(host.innerHTML,/分类结果暂不可用/);
  const stale={innerHTML:''};const pending=renderClassification(stale,()=>false,new URLSearchParams('case=spambase'));stale.innerHTML='another page';await pending;assert.equal(stale.innerHTML,'another page');
 }finally{globalThis.fetch=original;}
});

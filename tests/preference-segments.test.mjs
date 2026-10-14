import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyPreference,renderPreference,PREFERENCE_METHODS} from '../apps/web/preference-segments.js';
import {caseReading,caseExercise} from '../apps/web/case-reading.js';
import {learningContextHtml} from '../apps/web/learning-context.js';
const root=new URL('../apps/web/preference-results/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root)));
const bytes=await readFile(new URL(manifest.path,root)),p=JSON.parse(bytes);
test('preference package binds original RFM result and recalculates all future denominators',async()=>{
 assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
 const old=JSON.parse(await readFile(new URL('../apps/web/monitoring-results/manifest.json',import.meta.url)));
 assert.equal(p.parent_sha256,old.resources.segments.sha256);assert.equal(p.parent_run,old.resources.segments.run_id);
 assert.equal(verifyPreference(p),p);
 for(const w of p.windows){assert.ok(w.metrics.hdbscan.unassigned>w.rows.length*.8);assert.ok(w.future.leiden.group_recall<w.future.matched.group_recall);}
});
test('preference verification rejects altered noise counts, targets and displayed outcome',()=>{
 for(const mutate of [q=>q.windows[0].metrics.hdbscan.unassigned++,q=>q.windows[0].future.leiden.rows[0].targets=0,q=>q.windows[0].future.matched.group_recall=.9]){const q=structuredClone(p);mutate(q);assert.throws(()=>verifyPreference(q));}
});
test('all preference methods and both periods have usable experience, report and lessons',()=>{
 for(const w of p.windows)for(const prefMethod of Object.keys(PREFERENCE_METHODS))for(const view of ['experience','report','models','data','learn']){
 const s={origin:w.origin,prefMethod,prefGroup:'all',prefPerson:''},html=renderPreference(p,s,view);
 assert.doesNotMatch(html,/undefined|NaN/);assert.match(html,/不是|不等于|不当作|不作为/);
 if(['experience','learn'].includes(view))assert.ok(w.rows.some(r=>r.id===s.prefPerson));
 }
 const s={origin:p.windows[0].origin,prefMethod:'hdbscan',prefGroup:'-1',prefPerson:''},html=renderPreference(p,s,'experience');
 assert.match(html,/未进入稳定密集群/);assert.match(html,/未归群顾客没有共同代表商品/);
 assert.equal(p.windows[0].rows.find(r=>r.id===s.prefPerson).labels.hdbscan,-1);
});
test('preference methods, teaching and legacy RFM retain distinct scope',()=>{
 const q=new URLSearchParams({case:'retail',basis:'preference',prefMethod:'hdbscan',prefPerson:'12347'});
 assert.match(caseReading('segments',q).delivery,/Leiden/);assert.match(caseExercise('segments',q).recipe,/图邻居/);
 const html=learningContextHtml('segments',q,'learn');assert.match(html,/偏好编码/);assert.match(html,/prefMethod=hdbscan/);assert.match(html,/prefPerson=12347/);
 q.set('basis','rfm');assert.match(caseReading('segments',q).delivery,/RFM 特征/);assert.doesNotMatch(caseExercise('segments',q).recipe,/图邻居/);
});

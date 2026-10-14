import test from 'node:test';
import assert from 'node:assert/strict';
import {caseMethodHref,PUBLIC_CASE_PATHS,publicCasePath,publicLessonHref,casePathDirectory} from '../apps/web/case-paths.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
import {CASE_READINGS} from '../apps/web/case-reading.js';
import {CASE_EXERCISES} from '../apps/web/case-exercises.js';
import {resolveGuideSelection} from '../apps/web/model-guide.js';

test('seven public method and calculation links lead to the intended frozen case',()=>{
 assert.equal(PUBLIC_CASE_PATHS.length,7);
 assert.equal(new Set(PUBLIC_CASE_PATHS.map(c=>c.key)).size,7);
 for(const c of PUBLIC_CASE_PATHS){
  const [page,id]=c.key.split(':');
  assert.ok(CASE_READINGS[c.key]);assert.ok(CASE_EXERCISES[c.key]);
  assert.ok(c.scene.length>4&&c.decision.length>12&&c.method.length>12);
  assert.equal(publicCasePath(c.key),c);
  const method=resolveRoute(c.methodHref,false);
  assert.equal(method.error,undefined);
  assert.equal(method.params.get('case'),id);
  assert.equal(method.page,page==='recommend'||page==='forecast'?'models':page);
  if(method.page==='models'){
   assert.equal(method.params.get('focus'),'detail');
   const {selected}=resolveGuideSelection(method.params);
   assert.equal(selected.caseId,id);
   assert.equal(selected.task,method.params.get('task'));
  }else assert.equal(method.params.get('view'),'models');
  const lesson=resolveRoute(publicLessonHref(c.key),false);
  assert.equal(lesson.error,undefined);
  assert.equal(lesson.page,page==='recommend'?'learn':page);
 }
 assert.equal(publicCasePath('forecast:m5'),null);
 assert.doesNotMatch(casePathDirectory('methods'),/M5|Dressipi/);
 assert.match(casePathDirectory('teaching'),/查看计算/);
});

test('method links preserve the live task and model instead of the public default',()=>{
 for(const [page,id,task,model] of [['recommend','tafeng','discovery','itemcf_excluding_history'],['forecast','uci','daily_sales','lgbm_history_l1']]){
  const q=new URLSearchParams({case:id,task,model,view:'experience',walk:'example'});
  const r=resolveRoute(caseMethodHref(page,q),false);
  assert.equal(r.page,'models');assert.equal(r.params.get('task'),task);assert.equal(r.params.get('model'),model);
  const selection=resolveGuideSelection(r.params);assert.equal(selection.selected.task,task);assert.equal(selection.model,model);
  assert.equal(q.get('view'),'experience');
 }
});

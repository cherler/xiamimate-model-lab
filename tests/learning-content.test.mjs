import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {windowRecall} from '../apps/web/uci-recommendation-lesson.js';
import {learningContextHtml} from '../apps/web/learning-context.js';
import {PUBLIC_CASE_PATHS} from '../apps/web/case-paths.js';
import {resolveRoute} from '../apps/web/case-navigation.js';

test('UCI teaching reproduces all saved macro scores and distinguishes user-window weighting',()=>{
 const root='apps/web/uci-results/',m=JSON.parse(fs.readFileSync(root+'manifest.json'));
 const r=JSON.parse(fs.readFileSync(root+m.version+'/report.json'));
 for(const model of Object.values(r.recommendation.models))assert.equal(windowRecall(model).equal,model.metrics.recall);
 const example={windows:[{users:1,recall:1},{users:9,recall:0}],metrics:{recall:.5}};
 assert.deepEqual(windowRecall(example),{equal:.5,weighted:.1});
 assert.throws(()=>windowRecall({...example,metrics:{recall:.1}}),/保存报告不一致/);
 assert.throws(()=>windowRecall({windows:[],metrics:{recall:0}}),/逐窗口指标/);
});
test('seven method and learning introductions link to their own evidence and preserve selection',()=>{
 for(const c of PUBLIC_CASE_PATHS)for(const mode of ['models','learn']){
  const [business,id]=c.key.split(':'),q=new URLSearchParams({case:id,model:'chosen',origin:'2011-09-01',business});
  const html=learningContextHtml(business,q,mode);
  assert.ok(html.includes(mode==='models'?'迁移到新业务需要':'计算后检查'));
  for(const match of html.matchAll(/href="([^"]+)"/g)){
   const r=resolveRoute(match[1].replaceAll('&amp;','&'),false);
   assert.equal(r.params.get('case'),id);assert.equal(r.params.get('model'),'chosen');assert.equal(r.params.get('origin'),'2011-09-01');
   if(['models','learn','expand'].includes(r.page))assert.equal(r.params.get('business'),business);else assert.equal(r.page,business);
  }
 }
});
test('daily forecasting lessons use daily denominators rather than weekly task claims',()=>{
 const q=new URLSearchParams({case:'uci',task:'daily_sales'});
 const html=learningContextHtml('forecast',q,'learn');
 assert.match(html,/商品日误差与逐窗口汇总/);assert.match(html,/不能代替逐日尖峰预测/);
 assert.doesNotMatch(html,/商品周绝对误差差/);
 assert.equal(learningContextHtml('forecast',new URLSearchParams({case:'missing'}),'learn'),'');
});

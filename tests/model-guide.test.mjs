import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GUIDE,guideMetrics,guideLink} from '../apps/web/model-guide.js';
const base=new URL('../apps/web/showcase/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
const reports=Object.fromEntries(await Promise.all(manifest.cases.map(async e=>[e.id,JSON.parse(await readFile(new URL(e.resources.report,base)))])));
test('every explained variant has actual metrics and a matching case/task/model link',()=>{
 for(const c of GUIDE) for(const v of c.variants) {
  const m=guideMetrics(c,v.model,reports[c.caseId]);assert.ok(m);
  const [page,query]=guideLink(c,v.model).split('?'),p=new URLSearchParams(query);
  assert.equal(p.get('case'),c.caseId);assert.equal(p.get('task'),c.task);assert.equal(p.get('model'),v.model);
  assert.equal(page,['daily_sales','weekly_sales'].includes(c.task)?'#forecast':'#recommend');
 }
});
test('all Ta Feng final methods are explained; recommendation and forecast scopes stay separate',()=>{
 const r=reports.tafeng;
 for(const task of ['repurchase','discovery','weekly_sales']) {
  const ids=GUIDE.filter(c=>c.caseId==='tafeng'&&c.task===task).flatMap(c=>c.variants.map(v=>v.model)).sort();
  assert.deepEqual(ids,Object.keys(task==='weekly_sales'?r.weekly:r.recommendation[task]).sort());
 }
 const c=GUIDE.find(c=>c.id==='hybrid');
 const m=guideMetrics(c,'als_decay_25',r);
 assert.equal(m.customers,13255);assert.equal(m.nonempty_target_customers,6179);
 assert.throws(()=>guideMetrics(c,'not-a-model',r),/指标缺失/);
 const forecast=GUIDE.find(c=>c.id==='lgbm');
 assert.ok(guideMetrics(forecast,forecast.variants[0].model,r).bias<-.2);
 assert.ok(guideMetrics(GUIDE.find(c=>c.id==='category'),'als_category_25',r).ndcg<r.recommendation.discovery.itemcf_excluding_history.warm.ndcg);
});

const {resolveGuideSelection,guideScope}=await import('../apps/web/model-guide.js');
test('every UCI daily and weekly forecast is explained and resolved to its own task',()=>{
 for(const [task,key] of [['daily_sales','forecast'],['weekly_sales','weekly']]) {
  const cards=GUIDE.filter(c=>c.caseId==='uci'&&c.task===task);
  assert.deepEqual(cards.flatMap(c=>c.variants.map(v=>v.model)).sort(),Object.keys(reports.uci[key].models).sort());
  for(const card of cards)for(const v of card.variants){
   const {selected,model}=resolveGuideSelection(new URLSearchParams({case:'uci',task,model:v.model}));
   assert.equal(selected.id,card.id);assert.equal(model,v.model);
   const m=guideMetrics(selected,model,reports.uci);
   assert.deepEqual(m,reports.uci[key].models[model].metrics);
   assert.match(guideScope(selected,m,reports.uci),task==='daily_sales'?/商品日/:/144 个商品周/);
  }
 }
 const daily=resolveGuideSelection(new URLSearchParams('case=uci&task=daily_sales&model=lightgbm'));
 const weekly=resolveGuideSelection(new URLSearchParams('case=uci&task=weekly_sales&model=lightgbm'));
 assert.notEqual(daily.selected.id,weekly.selected.id);
 assert.notEqual(guideMetrics(daily.selected,daily.model,reports.uci).wape,guideMetrics(weekly.selected,weekly.model,reports.uci).wape);
 assert.equal(resolveGuideSelection(new URLSearchParams('model=hybrid')).selected.id,'hybrid');
 assert.equal(resolveGuideSelection(new URLSearchParams('case=invalid&task=invalid&model=invalid')).selected.id,'hybrid');
});

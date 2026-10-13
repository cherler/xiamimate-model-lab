import test from 'node:test';
import assert from 'node:assert/strict';
import {CASES,resolveRoute,caseHref} from '../apps/web/case-navigation.js';
import {reciprocalRank,attributeOverlap} from '../apps/web/dressipi.js';
test('legacy links preserve task and M5 view selections within two case entrances',()=>{
 const m=resolveRoute('#m5?window=1885&model=seasonal_naive&level=item&item=FOODS_1_001_CA_1');
 assert.equal(m.page,'forecast');assert.equal(m.params.get('case'),'m5');assert.equal(m.params.get('window'),'1885');assert.equal(m.params.get('level'),'item');
 for(const [hash,page,view] of [['#advanced?task=forecast','forecast','advanced'],['#advanced','recommend','advanced'],['#automl?task=forecast&view=tuning','forecast','tuning'],['#automl','recommend','selection']]){
  const r=resolveRoute(hash);assert.equal(r.page,page);assert.equal(r.params.get('case'),'uci');assert.equal(r.params.get('view'),view);
 }
});
test('defaults remain task specific and unknown cases never silently use another dataset',()=>{
 assert.equal(resolveRoute('#forecast').params.get('case'),'m5');assert.equal(resolveRoute('#recommend').params.get('case'),'tafeng');
 assert.ok(resolveRoute('#forecast?case=dressipi').error);assert.ok(resolveRoute('#recommend?case=unknown').error);
 for(const [task,cases] of Object.entries(CASES))for(const c of cases)for(const view of c.views){const r=resolveRoute(caseHref(task,c.id,view));assert.equal(r.params.get('view'),view);assert.ok(!r.error);}
 assert.equal(resolveRoute('#recommend?case=tafeng&view=selection').params.get('view'),'experience');
});
test('anonymous attributes match by category/value pair; no invented semantics or conditional ranking metric',()=>{
 assert.deepEqual(attributeOverlap([['1','2'],['3','4']],[['9','2'],['1','2']]),[['1','2']]);
 assert.equal(reciprocalRank('b',['a','b']),.5);assert.equal(reciprocalRank('x',['a','b']),0);assert.equal(reciprocalRank('b',['a','b'],1),0);
});

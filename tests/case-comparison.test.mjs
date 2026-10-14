import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compareRecommendation,recommendationCohort,rankOutcome,compareForecast} from '../apps/web/case-comparison.js';
import {dressipiDuel,dressipiGroups,forecastContribution} from '../apps/web/case-depth.js';
test('recommendation pair distinguishes candidate failure, cutoff, hit and equal failures',()=>{
 const s={target:'T',target_retrieved:true,rankings:{a:['T','x'],b:['x','T'],c:['x']}};
 assert.equal(compareRecommendation(s,'a','b').delta,.5);assert.equal(compareRecommendation(s,'b','a').status,'worse');
 assert.equal(compareRecommendation(s,'c','c').status,'tied');assert.equal(rankOutcome(s,'c').stage,'outside100');
 assert.equal(rankOutcome({...s,target_retrieved:false},'c').stage,'retrieval');assert.throws(()=>rankOutcome({...s,target_retrieved:false},'a'));
 const long={...s,rankings:{a:[...Array.from({length:10},(_,i)=>String(i)),'T']}};assert.equal(rankOutcome(long,'a').stage,'outside10');assert.equal(rankOutcome(s,'a').stage,'hit');
 assert.deepEqual(compareRecommendation(s,'a','b').common,['T','x']);
 assert.equal(recommendationCohort([s,long],'a','a').counts.tied,2);
});
test('forecast error contribution reconciles days and weeks including zero sales and regressions',()=>{
 const actual=[0,10,2,0,4,5,2,1],current=[2,9,1,0,4,6,2,1],base=[0,5,1,3,5,5,2,4];
 const c=compareForecast(actual,current,base);assert.equal(c.error,5);assert.equal(c.baseError,13);assert.equal(c.gain,8);
 assert.equal(c.rows.reduce((n,r)=>n+r.gain,0),8);assert.equal(c.weeks.reduce((n,r)=>n+r.gain,0),8);assert.deepEqual(c.counts,{improved:4,tied:2,worse:2});
 assert.equal(compareForecast(actual,current,current).gain,0);assert.equal(compareForecast([0],[2],[0]).relative,null);
 for(const args of [[[],[],[]],[[0],[1,2],[0]],[[0],[NaN],[0]],[[0],[-1],[0]]])assert.throws(()=>compareForecast(...args));
});
test('frozen Dressipi pairs cover every retained sample without altering population diagnostics',async()=>{
 const root=new URL('../apps/web/dressipi-results/',import.meta.url),m=JSON.parse(await readFile(new URL('manifest.json',root)));
 const load=async key=>JSON.parse(await readFile(new URL(m.resources[key].path,root)));
 const [bundle,study]=await Promise.all([load('samples'),load('study')]);const names={lightgbm:'LightGBM',cooccurrence:'共现',attributes:'属性',popularity:'热门'};
 for(const a of Object.keys(names))for(const b of Object.keys(names)){
  const c=recommendationCohort(bundle.samples,a,b);assert.equal(c.total,12);assert.equal(Object.values(c.counts).reduce((a,b)=>a+b),12);
  if(a===b)assert.equal(c.counts.tied,12);
  for(const {sample,result} of c.rows){const html=dressipiDuel(sample,a,b,names);assert.ok(!/NaN|undefined/.test(html));assert.ok(result.common.length+result.added.length===sample.rankings[a].slice(0,10).length);}
 }
 for(const field of Object.keys(study.diagnostics.groups))assert.match(dressipiGroups(study,field),/1,000/);
 const corrupted=structuredClone(study);corrupted.diagnostics.groups.session_length[0].sessions++;assert.throws(()=>dressipiGroups(corrupted,'session_length'));
});
test('frozen M5 error totals reconcile all windows groups and method pairs',async()=>{
 const root=new URL('../apps/web/m5-results/',import.meta.url),m=JSON.parse(await readFile(new URL('manifest.json',root))),o=JSON.parse(await readFile(new URL(m.resources.overview.path,root)));
 for(const w of o.windows)for(const s of Object.values(w.groups))for(const a of Object.keys(s.predictions))for(const b of Object.keys(s.predictions)){
  const c=compareForecast(s.actual,s.predictions[a],s.predictions[b]);assert.equal(c.rows.length,28);assert.equal(c.weeks.length,4);
  assert.ok(Math.abs(c.gain-c.weeks.reduce((n,r)=>n+r.gain,0))<1e-7);assert.equal(Object.values(c.counts).reduce((n,v)=>n+v,0),28);
 }
 const w=o.windows[0],s=w.groups.store;assert.match(forecastContribution(s,'lgbm_tweedie_core','weekday_mean_8w',w.dates,{lgbm_tweedie_core:'模型',weekday_mean_8w:'基线'},'store'),/可能抵消/);
});

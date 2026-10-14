import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {itemCosts,pairedDecision,decisionPairView,packDiagnostics,outcomeEvidence,resourceComparisons,decisionOutcomeView,decisionResourceView,decisionApplicability} from '../apps/web/decision-depth.js';
import {findPlan} from '../apps/web/decision-metrics.js';
const root=new URL('../apps/web/decision-results/',import.meta.url),spec=JSON.parse(await readFile(new URL('manifest.json',root))),p=JSON.parse(await readFile(new URL(spec.path,root)));
const base={...p.protocol.default,origin:p.windows[0].origin,policy:'milp',axis:'strategy',reference:'point',item:''};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('D7 all saved orders decompose into additive per-item expected and observed costs',()=>{
 for(const w of p.windows)for(const plan of w.plans)for(const policy of ['point','buffer','milp']){
  const rows=itemCosts(w,plan,policy,p.protocol);assert.equal(rows.length,12);
  for(const kind of ['expected','observed'])for(const key of ['purchase','holding','shortage_cost','total_cost'])near(rows.reduce((s,r)=>s+r[kind][key],0),plan.policies[policy][kind][key]);
  for(const r of rows){near(r.observed.total_cost,r.observed.purchase+r.observed.holding+r.observed.shortage_cost);near(r.expected.purchase,r.observed.purchase);}
 }
});
test('D7 controlled pairs hold resources and exactly one model/strategy dimension fixed across all assumptions',()=>{
 for(const budget of p.protocol.budget_ratios)for(const capacity of p.protocol.capacity_ratios)for(const shortage of p.protocol.shortage_price_ratios)for(const model of ['four_week_mean','lightgbm'])for(const policy of ['point','buffer','milp'])for(const axis of ['strategy','forecast']){
  const s={...base,budget,capacity,shortage,model,policy,axis},e=pairedDecision(p,s);
  assert.equal(e.windows.length,12);assert.equal(e.improved+e.worse+e.tied,12);
  assert.equal(e.sides.current[axis==='forecast'?'policy':'model'],e.sides.reference[axis==='forecast'?'policy':'model']);
  near(e.gain,e.windows.reduce((a,w)=>a+w.gain,0));
  for(const [i,w] of e.windows.entries()){
   const a=findPlan(p.windows[i],{...s,model:e.sides.current.model}),b=findPlan(p.windows[i],{...s,model:e.sides.reference.model});
   assert.equal(a.budget,b.budget);assert.equal(a.capacity,b.capacity);
   near(w.gain,w.reference.observed.total_cost-w.current.observed.total_cost);
   for(const r of w.rows)near(r.gain.total_cost,r.gain.purchase+r.gain.holding+r.gain.shortage_cost);
  }
 }
});
test('D7 preserves default loss, identical-policy zero gain, forecast denominator and zero-demand case',()=>{
 const e=pairedDecision(p,base);near(e.gain,-115061.3);near(e.totals.current.demand_units,90682);
 const same=pairedDecision(p,{...base,reference:'milp'});assert.equal(same.gain,0);assert.equal(same.tied,12);
 const f=pairedDecision(p,{...base,axis:'forecast'});near(f.totals.current.wape,p.windows.flatMap(w=>w.items).reduce((s,r)=>s+Math.abs(r.predictions.lightgbm-r.actual),0)/90682);near(f.gain,31402);
 const zero=structuredClone(p);for(const w of zero.windows)for(const plan of w.plans)for(const v of Object.values(plan.policies))v.observed.demand_units=0;
 assert.equal(pairedDecision(zero,base).totals.current.wape,null);
});
test('D7 presentation retains failures, cross-forecast scope, escaped product names and paired links',()=>{
 const v=structuredClone(p);v.windows[0].items[0].name='<script>alert(1)</script>';
 const html=decisionPairView(v,base);assert.match(html,/成本增加/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/item=15036/);assert.match(html,/reference=point/);
 assert.match(decisionPairView(p,{...base,axis:'forecast'}),/场景分布不同/);assert.match(decisionPairView(p,{...base,reference:'milp'}),/完全相同/);
 const report=decisionPairView(p,base,true);assert.equal((report.match(/逐商品核算/g)||[]).length,12);
});

test('D7 target/outcome gaps add up for every scope; demand envelope is descriptive only',()=>{
 for(const model of ['four_week_mean','lightgbm'])for(const policy of ['point','buffer','milp'])for(const report of [false,true]){
  const e=outcomeEvidence(p,{...base,model,policy},report);assert.equal(e.rows.length,report?144:12);near(e.delta.purchase,0);
  for(const k of ['purchase','holding','shortage_cost','total_cost'])near(e.delta[k],e.rows.reduce((s,r)=>s+r.delta[k],0));
  near(e.delta.total_cost,e.delta.holding+e.delta.shortage_cost);
  assert.equal(e.below+e.above+e.rows.filter(r=>r.actual>=r.low&&r.actual<=r.high).length,e.rows.length);
 }
 assert.match(decisionOutcomeView(p,base,true),/发生反转/);assert.match(decisionOutcomeView(p,{...base,axis:'forecast'},true),/不同需求场景/);
});
test('D7 extra-pack feasibility and scenario deltas hold for all frozen orders without future sales',()=>{
 for(const w of p.windows)for(const plan of w.plans)for(const policy of ['point','buffer','milp']){
  const rows=packDiagnostics(w,plan,policy,p.protocol),base=plan.policies[policy].expected;
  for(const [i,r] of rows.entries()){
   assert.equal(r.extraCash,p.protocol.pack_size*w.items[i].cost);
   assert.equal(r.budgetBlocked,base.budget_slack+1e-6<r.extraCash);
   assert.equal(r.capacityBlocked,base.capacity_slack<p.protocol.pack_size);
   assert.equal(r.feasible,!r.budgetBlocked&&!r.capacityBlocked);
   if(policy==='milp'&&r.feasible)assert.ok(r.expectedDelta>=-.01);
  }
 }
 const w=p.windows[0],plan=findPlan(w,base),before=packDiagnostics(w,plan,'milp',p.protocol),changed=structuredClone(w);changed.items.forEach(r=>r.actual=1e6);assert.deepEqual(packDiagnostics(changed,plan,'milp',p.protocol),before);
 // No spare unit/cash is reported as an executable additional pack.
 const cfg={pack_size:6,holding_purchase_ratio:.1},tiny={items:[{id:'x',name:'x',initial:0,weeks:[6,6],cost:2,price:3,predictions:{m:6},actual:6}]},empty={model:'m',budget_ratio:0,capacity_ratio:0,shortage_ratio:1,policies:{milp:{packs:[0]}}};
 const d=packDiagnostics(tiny,empty,'milp',cfg)[0];assert.ok(d.budgetBlocked&&d.capacityBlocked&&!d.feasible);assert.ok(d.expectedDelta<0);
});
test('D7 saved resource comparisons change only one bound and retain objective monotonicity for MILP',()=>{
 for(const w of p.windows)for(const model of ['four_week_mean','lightgbm'])for(const shortage of p.protocol.shortage_price_ratios){
  const s={...base,origin:w.origin,model,shortage};
  for(const group of resourceComparisons(p,s)){
   const fixedKey=group.key==='budget'?'capacity':'budget';assert.equal(new Set(group.rows.map(r=>r[fixedKey])).size,1);
   for(let i=1;i<group.rows.length;i++)assert.ok(group.rows[i].expected.total_cost<=group.rows[i-1].expected.total_cost+.01);
   for(const r of group.rows){const expected=findPlan(w,{...s,[group.key]:r.value});near(r.expected.total_cost,expected.policies.milp.expected.total_cost);assert.ok(r.observed.feasible);}
  }
 }
 const text=decisionResourceView(p,base);assert.match(text,/不是资源影子价格/);assert.match(text,/并非没有资源可用/);assert.match(decisionApplicability(),/前瞻或独立评估/);
});

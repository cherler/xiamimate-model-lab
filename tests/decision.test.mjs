import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decisionInput,decisionMetrics,rulePacks,findPlan,aggregatePlans,verifyDecision} from '../apps/web/decision-metrics.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
const cfg={holding_purchase_ratio:.1,pack_size:2};
const items=[{id:'a',weeks:[1,5],initial:1,cost:2,price:4,predictions:{m:3}},{id:'b',weeks:[2,4],initial:0,cost:3,price:6,predictions:{m:3}}];
test('decision costs use units, procurement, holding and unmet sales with consistent denominators',()=>{
 const x=decisionInput(items,{model:'m',budget_ratio:2,capacity_ratio:2,shortage_ratio:1.5},cfg),m=decisionMetrics(x,[1,1],[4,1]);
 assert.equal(m.purchase,10);assert.equal(m.shortage_cost,6);assert.equal(m.holding,.30000000000000004);assert.equal(m.fill_rate,.8);assert.ok(m.feasible);
 assert.equal(decisionMetrics(x,[0,0],[0,0]).fill_rate,null);assert.equal(decisionMetrics(x,[1.5,0],[4,1]).feasible,false);
});
test('rule allocation obeys tight cash capacity and zero resource conditions',()=>{
 for(const b of [0,.1,.6,1,4])for(const c of [.25,.75,1.25]){const x=decisionInput(items,{model:'m',budget_ratio:b,capacity_ratio:c,shortage_ratio:1},cfg);for(const buffer of [false,true])assert.ok(decisionMetrics(x,rulePacks(x,'m',buffer)).feasible);}
});
test('decision routes retain invalid cases for explicit errors',()=>{
 const r=resolveRoute('#decision');assert.equal(r.page,'decision');assert.equal(r.params.get('case'),'retail');assert.equal(r.params.get('view'),'experience');assert.equal(resolveRoute('#decision?case=bad').params.get('case'),'bad');
});
test('all saved R6 plans independently reproduce constraints rules scenario and outcome costs',async()=>{
 const root=new URL('../apps/web/decision-results/',import.meta.url),spec=JSON.parse(await readFile(new URL('manifest.json',root))),bytes=await readFile(new URL(spec.path,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);const p=verifyDecision(JSON.parse(bytes));assert.equal(p.run_id,spec.run_id);
 for(const mutation of [v=>v.windows[0].plans[0].policies.milp.packs[0]++,v=>v.windows[0].plans.pop(),v=>v.windows[0].items[0].actual++,v=>v.windows[0].plans[0].policies.milp.status=1,v=>v.windows[0].items[0].predictions.four_week_mean++]){const v=structuredClone(p);mutation(v);assert.throws(()=>verifyDecision(v));}
 const plans=p.windows.map(w=>findPlan(w,p.protocol.default)),a=aggregatePlans(plans,'milp');assert.ok(a.feasible);assert.equal(a.demand_units,90682);assert.ok(Math.abs(a.total_cost-9586259.7)<1e-6);
 assert.equal(findPlan(p.windows[0],{...p.protocol.default,budget:9}),undefined);
});
test('missing R6 results fail clearly and obsolete route cannot overwrite the current page',async()=>{
 const old=globalThis.fetch;try{globalThis.fetch=async()=>({ok:false});const {renderDecision}=await import('../apps/web/decision.js');const h={innerHTML:''};await renderDecision(h,()=>true,new URLSearchParams({case:'retail'}));assert.match(h.innerHTML,/暂不可用/);await renderDecision(h,()=>false,new URLSearchParams({case:'retail'}));assert.doesNotMatch(h.innerHTML,/暂不可用/);await renderDecision(h,()=>true,new URLSearchParams({case:'missing'}));assert.match(h.innerHTML,/案例不存在/);}finally{globalThis.fetch=old;}
});

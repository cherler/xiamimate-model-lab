import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRetail,compareRetail,executeTool,runWorkflow,retailOptions,validateArgs} from '../services/assistant/tools.mjs';
const p=await loadRetail(),selection={origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5};
test('assistant recomputes every frozen retail combination without using observed sales in planning',()=>{
 let checked=0;
 for(const w of p.windows)for(const plan of w.plans){const s={origin:w.origin,model:plan.model,budget:plan.budget_ratio,capacity:plan.capacity_ratio,shortage:plan.shortage_ratio};const before=compareRetail(p,s),after=compareRetail(p,s,true);
  assert.equal(JSON.stringify(before).includes('recordedSales'),false);
  for(const method of ['point','buffer','milp']){for(const [got,want] of [[before.policies[method].metrics,plan.policies[method].expected],[after.policies[method].metrics,plan.policies[method].observed]])for(const k of Object.keys(want)){if(typeof want[k]==='number')assert.ok(Math.abs(got[k]-want[k])<1e-6,k);else assert.equal(got[k],want[k]);}assert.ok(before.policies[method].metrics.feasible);}checked++;
 }
 assert.equal(checked,432);
});
test('assistant rejects unsupported dates, numbers, unknown tools and research cases',async()=>{
 assert.throws(()=>compareRetail(p,{...selection,budget:.99}),/没有保存结果/);
 assert.throws(()=>compareRetail(p,{...selection,origin:'2026-10-15'}),/没有保存结果/);
 for(const a of [{...selection,budget:NaN},{...selection,path:'/etc/passwd'},{...selection,model:'__proto__'}])assert.throws(()=>validateArgs('retail_compare',a));
 await assert.rejects(executeTool('shell',{cmd:'echo'}),/未知工具/);
 await assert.rejects(executeTool('read_case',{key:'forecast:m5'}));
 assert.equal(retailOptions(p).origins.length,12);
});
test('workflow uses exact same explicit selection and identifies independent arithmetic rather than AI inference',async()=>{
 const r=await runWorkflow(selection,{load:async()=>p});assert.equal(r.mode,'workflow');assert.equal(r.usage,null);assert.deepEqual(r.trace.map(t=>t.name),['retail_compare','retail_review']);assert.deepEqual(r.trace[0].args,selection);
 await assert.rejects(runWorkflow(selection,{load:async()=>{throw new Error('损坏');}}),/损坏/);
 const expansion=await executeTool('read_expansion',{business:'recommend'});assert.match(expansion.status,/尚未/);
});

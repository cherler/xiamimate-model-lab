import test from 'node:test';
import assert from 'node:assert/strict';
import {moneyGBP,weekday,validateEvidence} from '../services/assistant/evidence.mjs';
import {loadRetail,compareRetail,retailOptions,executeTool} from '../services/assistant/tools.mjs';
import {runAssistant} from '../services/assistant/runtime.mjs';
const p=await loadRetail(),s={origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5},r=compareRetail(p,s),trace=[{ok:true,result:r}];
test('display amounts convert pence once and keep cost and shortage tradeoffs together',()=>{
 assert.equal(moneyGBP(624714.7),'£6,247.15');assert.equal(r.display.policies.point.total_cost,'£6,247.15');
 assert.match(r.display.comparison,/减少 £228.41/);assert.match(r.display.comparison,/缺货量增加 364.37 件/);
 assert.match(r.display.policies.point.statement,/预算余量 £319.25/);
 for(const w of p.windows)for(const plan of w.plans){const a={origin:w.origin,model:plan.model,budget:plan.budget_ratio,capacity:plan.capacity_ratio,shortage:plan.shortage_ratio};for(const review of [false,true]){const x=compareRetail(p,a,review);for(const key of ['point','buffer','milp'])assert.equal(x.display.policies[key].total_cost,moneyGBP(x.policies[key].metrics.total_cost));}}
});
test('supported windows have exact calendar dates without assuming one weekday',()=>{
 assert.equal(weekday('2011-10-01'),'星期六');assert.equal(weekday('2011-11-01'),'星期二');
 const options=retailOptions(p);assert.equal(options.windows.length,12);assert.equal(new Set(options.windows.map(w=>w.weekday)).size,3);assert.match(options.calendarNote,/离散/);
});
test('money and calendar regressions are rejected, valid amounts and dates survive',()=>{
 for(const summary of ['总成本 624714.70','总成本 £624,714.70','总成本 624714.70 便士','总成本 6247.15 英镑','2011-10-01（周四）','支持若干周四'])assert.throws(()=>validateEvidence({summary},trace),e=>e.kind==='evidence');
 for(const summary of ['总成本 £6,247.15，减少 £228.41；缺货增加 364.37 件。','2011-10-01（星期六）','记录销量不等于潜在需求。'])validateEvidence({summary},trace);
});
test('one evidence correction uses existing evidence and retains the rejected check',async()=>{
 let n=0;const result=await runAssistant({mode:'agent',question:'成本多少',selection:s},{complete:async()=>{
  if(++n===1)return {message:{tool_calls:[{id:'c',function:{name:'retail_compare',arguments:JSON.stringify(s)}}]}};
  return {message:{content:JSON.stringify({summary:n===2?'总成本 £624,714.70':'按点预测补货总成本 £6,247.15，仅为假设成本。',citations:[r.sources[0].id],brief:''})}};
 }});assert.equal(n,3);assert.equal(result.validation[0].code,'unsupported_money');assert.equal(result.validation.at(-1).ok,true);
});
test('case evidence includes actual upgrade status and does not promise unavailable numeric queries',async()=>{
 const c=await executeTool('read_case',{key:'recommend:uci'});assert.match(c.status,/没有逐样本/);const sasrec=c.modelPaths.find(p=>p.name.includes('SASRec'));assert.match(sasrec.status,/暂不直接套用/);assert.match(sasrec.data,/短购物篮/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {moneyGBP,weekday,validateEvidence,normalizeCalendar,selectionChanges} from '../services/assistant/evidence.mjs';
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
 for(const summary of ['总成本 624714.70','总成本 £624,714.70','总成本 6247.15 便士','总成本 624714.70 英镑','2011-10-01（周四）','支持若干周四'])assert.throws(()=>validateEvidence({summary},trace),e=>e.kind==='evidence');
 for(const summary of ['总成本 £6,247.15，减少 £228.41；缺货增加 364.37 件。','2011-10-01（星期六）','记录销量不等于潜在需求。','总成本 624714.70 便士 = 6247.15 英镑','并非都是周四，2011-10-01（星期六）。'])validateEvidence({summary},trace);
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

test('aggregate demand and gain screening cannot be turned into unsupported causal/statistical claims',()=>{
 const caseTrace=[{ok:true,result:{case:{}}}];
 assert.throws(()=>validateEvidence({summary:'这意味着没有达到统计意义上的显著提升门槛。'},caseTrace),e=>e.code==='unsupported_significance');
 validateEvidence({summary:'未通过增益筛选不等于统计显著性检验结论。'},caseTrace);
 assert.throws(()=>validateEvidence({summary:'实际需求比场景均值低，因此所有策略缺货成本下降。'},trace),e=>e.code==='unsupported_cause');
 validateEvidence({summary:'不能仅用需求均值解释成本变化。'},trace);
});

test('explicit date weekday typos are corrected by calendar arithmetic with an audit record',()=>{
 const input={summary:'2011-10-01（周四），2011-11-01 星期四。'};
 const {answer,corrections}=normalizeCalendar(input,trace);assert.equal(answer.summary,'2011-10-01（周六），2011-11-01 星期二。');assert.equal(corrections.length,2);assert.ok(corrections.every(c=>c.corrected));assert.match(input.summary,/周四/);
 assert.equal(normalizeCalendar({summary:'2011-10-01不是周四。'},trace).corrections.length,0);
 assert.equal(normalizeCalendar({summary:'2011-02-31（周四）'},trace).corrections.length,0);
});

test('upgrade notes do not mix experiment sample sizes and retail time scope is explicit',async()=>{
 const forecast=await executeTool('read_case',{key:'forecast:uci'});assert.doesNotMatch(JSON.stringify(forecast.modelPaths),/24 商品/);
 const retail=await executeTool('read_case',{key:'decision:retail'});assert.match(retail.timeScope,/七日窗口/);
 assert.throws(()=>validateEvidence({summary:'没有达到预设的统计或业务门槛，不能外推。'},[{ok:true,result:forecast}]),/统计显著性/);
});

test('a later disclaimer does not excuse an unsupported cause or mixed policy ranking',()=>{
 assert.throws(()=>validateEvidence({summary:'记录销量低于场景均值，因此缺货成本下降，但这不能证明收益。'},trace),e=>e.code==='unsupported_cause');
 const both=[...trace,{ok:true,result:compareRetail(p,s,true)}];
 assert.throws(()=>validateEvidence({summary:'三策略的相对位次在预期与事后两种视角下保持一致。'},both),e=>e.code==='mixed_rank_scope');
 assert.throws(()=>validateEvidence({summary:'优化策略的单位缺货代价高于点预测。'},trace),e=>e.code==='penalty_scope');
});

test('cross-budget item deltas are computed by the tool in the explicit direction',()=>{
 const low=compareRetail(p,{...s,budget:.6}),change=selectionChanges(r,low);assert.deepEqual(change.changed,['budget']);assert.equal(change.from.budget,1);assert.equal(change.to.budget,.6);
 for(const [key,c] of Object.entries(change.policies)){assert.equal(c.increased.length,0);assert.equal(c.decreased.length+c.unchanged.length,12);for(const item of [...c.decreased,...c.unchanged]){const i=low.items.findIndex(x=>x.id===item.id);assert.equal(item.deltaPacks,low.policies[key].packs[i]-r.policies[key].packs[i]);assert.equal(item.deltaUnits,item.deltaPacks*6);}}
 assert.equal(selectionChanges(r,r),null);assert.equal(selectionChanges(r,{...low,selection:{...low.selection,origin:'2011-10-01'}}),null);
});

test('presentation length alone does not reject a valid evidenced explanation',()=>{
 validateEvidence({summary:('请结合工具表格核对。'.repeat(100))+'总成本 £6,247.15。'},trace);
});

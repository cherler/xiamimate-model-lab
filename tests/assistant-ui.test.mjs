import test from 'node:test';
import assert from 'node:assert/strict';
import {answerHtml} from '../apps/web/assistant.js';
import {retailReportHtml,agentResultHtml,reportGroups} from '../apps/web/agent-case.js';
import {retailAnswer} from '../services/assistant/evidence.mjs';
import {executeTool,runWorkflow} from '../services/assistant/tools.mjs';
test('assistant renders model text and trace as plain escaped content and rejects external source links',()=>{
 const html=answerHtml({mode:'ask',summary:'<img src=x onerror=alert(1)>',model:'test',sources:[{href:'javascript:alert(1)',title:'bad'},{href:'#forecast?case=uci',title:'UCI'}],trace:[{name:'<script>',args:{unsafe:'<svg onload=evil()>'},result:{error:'<script>'},ok:false,ms:1}],ms:1});
 assert.doesNotMatch(html,/<img|<script|<svg|javascript:/);assert.match(html,/&lt;img/);assert.match(html,/href="#forecast\?case=uci"/);
});
test('retail report keeps expected and retrospective costs distinct, includes three policies and all items',async()=>{
 const r=await runWorkflow({origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5}),html=retailReportHtml(r);
 assert.match(html,/保存订单与历史需求场景复算/);assert.match(html,/事后模拟复算/);assert.match(html,/缺货量增加/);
 for(const t of r.trace){for(const item of t.result.items)assert.ok(html.includes(item.id));assert.match(html,/预算余量/);assert.match(html,/容量余量/);}
 assert.equal(reportGroups(r.trace).length,1);assert.equal((html.match(/aria-label="商品订单明细"/g)||[]).length,1);assert.ok(r.trace[0].result.sources[0].id!==r.trace[1].result.sources[0].id);
});

test('format checks are shown separately from tool calls and safely escaped',()=>{
 const html=answerHtml({summary:'ok',ms:1,trace:[],validation:[{attempt:1,ok:false,message:'<script>bad</script>'},{attempt:2,ok:true}]});
 assert.match(html,/回答校验与修正记录/);assert.match(html,/通过校验/);assert.doesNotMatch(html,/<script>|实际工具执行记录/);
});

test('tool report labels direction and exposes all ranks and changes',async()=>{
 const s={origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5};
 const a=await executeTool('retail_compare',s),b=await executeTool('retail_compare',{...s,budget:.6}),trace=[a,b].map(result=>({ok:true,name:'retail_compare',result}));
 const report={...retailAnswer(trace,s),trace,ms:1},html=retailReportHtml(report);
 assert.match(answerHtml(report),/工具计算结论/);assert.doesNotMatch(answerHtml(report),/AI 解释/);
 assert.match(html,/预算 1 → 0.6 倍/);assert.match(html,/同包数并列/);assert.match(html,/逐商品增减明细/);
 for(const item of b.display.rankings.point.rows)assert.ok(html.includes(item.name+' / '+item.id));
});

test('client report leads with both tradeoffs, hides verbose prose, and retains original download data',async()=>{
 const r=await runWorkflow({origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5});r.summary='UNABRIDGED_REPORT_TEXT';
 const original=JSON.stringify(r),html=agentResultHtml(r),first=html.split('<details')[0];
 assert.match(first,/减少 £228.41/);assert.match(first,/缺货量增加 364.37 件/);assert.match(first,/减少 £279.60/);assert.match(first,/缺货量增加 458 件/);
 assert.match(first,/预期总成本/);assert.match(first,/事后总成本/);assert.doesNotMatch(first,/UNABRIDGED|采购金额|商品 \/ 编号/);
 assert.ok(html.indexOf('完整计算说明、来源与执行记录')<html.indexOf('UNABRIDGED_REPORT_TEXT'));assert.doesNotMatch(html,/<details[^>]*\sopen/);
 assert.equal(JSON.stringify(r),original);assert.equal((html.match(/UNABRIDGED_REPORT_TEXT/g)||[]).length,1);
});
test('duplicate calls collapse, different resource selections stay separate, absent review is explicit',async()=>{
 const s={origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5},r=await runWorkflow(s),low=await executeTool('retail_compare',{...s,budget:.6});
 const trace=[...r.trace,r.trace[0],{name:'retail_compare',ok:true,result:low}];assert.equal(reportGroups(trace).length,2);
 const single=agentResultHtml({trace:[trace.at(-1)],summary:'detail',ms:1});assert.match(single,/本次未查询事后模拟/);assert.doesNotMatch(single,/<th scope="col">事后总成本/);
 const fallback=agentResultHtml({summary:'还需要日期',trace:[],ms:1});assert.match(fallback,/还需要日期/);assert.doesNotMatch(fallback,/补货分析结论/);
});
test('headline order difference counts distinct products rather than quantity totals',async()=>{
 const r=await runWorkflow({origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5});
 for(const t of r.trace){const d=t.result;for(const p of Object.values(d.policies))p.packs=[...d.policies.point.packs];d.policies.milp.packs[0]+=1;}
 const html=agentResultHtml(r);assert.match(html,/12 种商品中，1 种的补货数量因策略而异/);
});

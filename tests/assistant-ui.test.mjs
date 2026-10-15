import test from 'node:test';
import assert from 'node:assert/strict';
import {answerHtml} from '../apps/web/assistant.js';
import {retailReportHtml} from '../apps/web/agent-case.js';
import {runWorkflow} from '../services/assistant/tools.mjs';
test('assistant renders model text and trace as plain escaped content and rejects external source links',()=>{
 const html=answerHtml({mode:'ask',summary:'<img src=x onerror=alert(1)>',model:'test',sources:[{href:'javascript:alert(1)',title:'bad'},{href:'#forecast?case=uci',title:'UCI'}],trace:[{name:'<script>',args:{unsafe:'<svg onload=evil()>'},result:{error:'<script>'},ok:false,ms:1}],ms:1});
 assert.doesNotMatch(html,/<img|<script|<svg|javascript:/);assert.match(html,/&lt;img/);assert.match(html,/href="#forecast\?case=uci"/);
});
test('retail report keeps expected and retrospective costs distinct, includes three policies and all items',async()=>{
 const r=await runWorkflow({origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5}),html=retailReportHtml(r);
 assert.match(html,/保存订单与历史需求场景复算/);assert.match(html,/事后模拟复算/);assert.match(html,/缺货量增加/);
 for(const t of r.trace){for(const item of t.result.items)assert.ok(html.includes(item.id));assert.match(html,/预算余量/);assert.match(html,/容量余量/);}
 assert.equal((html.match(/<h2>/g)||[]).length,2);assert.ok(r.trace[0].result.sources[0].id!==r.trace[1].result.sources[0].id);
});

test('format checks are shown separately from tool calls and safely escaped',()=>{
 const html=answerHtml({summary:'ok',ms:1,trace:[],validation:[{attempt:1,ok:false,message:'<script>bad</script>'},{attempt:2,ok:true}]});
 assert.match(html,/回答校验与修正记录/);assert.match(html,/通过校验/);assert.doesNotMatch(html,/<script>|实际工具执行记录/);
});

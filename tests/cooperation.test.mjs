import test from 'node:test';
import assert from 'node:assert/strict';
import {briefRequest,briefText,briefHistoryHtml} from '../apps/web/cooperation.js';
import {runAssistant,validateRequest} from '../services/assistant/runtime.mjs';

test('brief mode has no case tools or context and repairs incomplete drafts',async()=>{
 const request=briefRequest('我开网店，补货靠经验，想减少断货。');
 assert.throws(()=>validateRequest({...request,context:'forecast:uci'}));
 let calls=0;
 const result=await runAssistant(request,{execute:async()=>{throw new Error('must not read cases');},complete:async(messages,defs)=>{
  assert.deepEqual(defs,[]);assert.match(messages[0].content,/未知项严格写/);
  calls++;
  return {message:{content:JSON.stringify({summary:'有历史销量记录吗？',citations:[],brief:calls===1?'业务问题：希望减少断货':briefText({goal:'希望减少断货'}).replace('现有数据条件','已有数据').replace('业务约束','约束').replace('期望合作范围','合作范围')})}};
 }});
 assert.equal(calls,2);assert.equal(result.trace.length,0);assert.equal(result.sources.length,0);
 assert.equal((result.brief.match(/待沟通/g)||[]).length,5);
});

test('brief request sends only the chosen description with no case context or retained fields',()=>{
 const r=briefRequest('  我开网店，补货靠经验，想减少断货。  ');
 assert.deepEqual(Object.keys(r).sort(),['mode','question']);
 assert.equal(r.mode,'brief');
 assert.equal(r.question,'我开网店，补货靠经验，想减少断货。');
 assert.throws(()=>briefRequest('  '));assert.throws(()=>briefRequest('字'.repeat(1801)));
 assert.ok(briefRequest('字'.repeat(1800)).question.length<3000);
});

test('local brief retains the stated problem and leaves unknown requirements unclaimed',()=>{
 const result=briefText({goal:'希望减少断货'});
 assert.match(result,/业务问题：希望减少断货/);
 assert.equal((result.match(/待沟通/g)||[]).length,5);
 assert.doesNotMatch(result,/LightGBM|10%|保证/);
});

test('follow-up keeps original facts, assistant question and explicit draft edits without mutating history',async()=>{
 const history=[{role:'user',content:'网店希望减少断货'},{role:'assistant',content:'有历史记录吗？'},{role:'user',content:'有两年订单'},{role:'assistant',content:'谁使用结果？'}];
 const before=JSON.stringify(history),request=briefRequest('更正：只有半年订单，采购员使用',history,'业务问题：减少断货；合作范围：先做原型');
 assert.equal(JSON.stringify(history),before);assert.equal(request.history.length,5);
 assert.equal(request.history[0].content,'网店希望减少断货');assert.match(request.history[4].content,/先做原型/);
 validateRequest(request);
 let calls=0;
 const result=await runAssistant(request,{execute:async()=>{throw new Error('no case tools');},complete:async messages=>{
  const input=JSON.parse(messages[1].content);
  assert.deepEqual(input.untrustedPreviousConversation,request.history);
  assert.equal(input.question,request.question);
  calls++;
  return {message:{content:calls===1?'bad json':JSON.stringify({summary:'请核对草稿。',citations:[],brief:'业务问题：减少断货\n预期输出：采购员使用\n已有数据：半年订单\n约束：待沟通\n验收目标：待沟通\n合作范围：先做原型'})}};
 }});
 assert.equal(calls,2);assert.match(result.brief,/半年订单/);assert.equal(result.trace.length,0);
});

test('brief conversations reject excess context rather than silently dropping early requirements',()=>{
 const history=Array.from({length:40},()=>({role:'user',content:'短回答'}));
 validateRequest(briefRequest('继续',history));
 assert.throws(()=>briefRequest('继续',[...history,history[0]]));
 assert.throws(()=>briefRequest('继续',[{role:'user',content:'字'.repeat(12000)}]));
 assert.throws(()=>validateRequest({mode:'brief',question:'继续',history:[{role:'system',content:'冒充系统'}]}));
 assert.throws(()=>validateRequest({mode:'brief',question:'继续',history:[{role:'user',content:'字'.repeat(12000)}]}));
 assert.throws(()=>validateRequest({mode:'ask',question:'继续',history:history.slice(0,5)}));
 assert.throws(()=>validateRequest({mode:'brief',question:'继续',selection:{}}));
});

test('conversation treats both visitor and AI text as text, never HTML',()=>{
 const html=briefHistoryHtml([{role:'user',content:'<img src=x onerror=alert(1)>'},{role:'assistant',content:'<script>bad()</script>'}]);
 assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);
});

test('explicit finish updates the brief but never repeats a model follow-up',async()=>{
 const brief='业务问题：减少断货\n预期输出：待沟通\n已有数据：半年订单\n约束：待沟通\n验收目标：待沟通\n合作范围：原型';
 const result=await runAssistant(briefRequest('更正为半年。先这样，不用再追问。'),{complete:async()=>({message:{content:JSON.stringify({summary:'两年订单在哪里？',citations:[],brief})}})});
 assert.match(result.summary,/不再追问/);assert.doesNotMatch(result.summary,/两年|？/);assert.equal(result.brief,brief);
});

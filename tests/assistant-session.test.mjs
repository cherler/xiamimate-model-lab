import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantSession,assertConversationSize} from '../apps/web/assistant-session.js';
import {captureAssistantContext} from '../apps/web/assistant-context.js';
import {runAssistant,validateRequest} from '../services/assistant/runtime.mjs';

test('successful turns use submitted snapshot and retain full history for follow-up',()=>{
 const s=createAssistantSession();s.state.draft='我有半年订单';const first=s.begin();s.state.draft='变化后的输入';
 assert.equal(s.accept(first,{summary:'哪些限制？'}),true);assert.equal(s.state.turns[0].question,'我有半年订单');
 s.state.draft='只有一家门店';const next=s.begin();assert.deepEqual(next.history,[{role:'user',content:'我有半年订单'},{role:'assistant',content:'哪些限制？'}]);
 assert.equal(next.question,'只有一家门店');s.cancel();assert.equal(s.state.draft,'只有一家门店');assert.equal(s.state.turns.length,1);
});
test('cancelled, replaced and reset requests cannot overwrite newer conversation',()=>{
 const s=createAssistantSession();s.state.draft='原问题';const a=s.begin();s.cancel();assert.equal(a.controller.signal.aborted,true);
 s.state.draft='新问题';const b=s.begin();assert.equal(s.accept(a,{summary:'旧回答'}),false);assert.equal(s.fail(a,new Error('旧错误')),false);assert.equal(s.state.pending,b);
 assert.equal(s.accept(b,{summary:'新回答'}),true);assert.equal(s.state.turns.length,1);
 s.state.draft='待清空';const c=s.begin();s.reset();assert.equal(s.accept(c,{summary:'晚到回答'}),false);assert.deepEqual(s.state.turns,[]);assert.equal(s.state.draft,'');
});
test('failed requests preserve text and history without appending a turn',()=>{
 const s=createAssistantSession();s.state.draft='保留问题';const r=s.begin();assert.equal(s.fail(r,new Error('网络失败')),true);
 assert.equal(s.state.draft,'保留问题');assert.equal(s.state.error,'网络失败');assert.equal(s.state.turns.length,0);
});
test('conversation limits reject rather than silently truncating early conditions',()=>{
 const history=Array.from({length:40},()=>({role:'user',content:'条件'}));assert.doesNotThrow(()=>assertConversationSize('继续',history));
 assert.throws(()=>assertConversationSize('继续',[...history,history[0]]),/先复制/);assert.throws(()=>assertConversationSize('继续',[{content:'x'.repeat(12000)}]),/先复制/);
 assert.doesNotThrow(()=>validateRequest({mode:'ask',question:'继续',history}));assert.throws(()=>validateRequest({mode:'ask',question:'继续',history:[{role:'user',content:'x'.repeat(12000)}]}),/过长/);
});
test('case conversations persist across methods and selection changes but isolate other cases and research',()=>{
 const a=captureAssistantContext('#recommend?case=uci&customer=12345&model=hybrid');
 assert.deepEqual(a,captureAssistantContext('#models?business=recommend&case=uci&customer=11111'));
 assert.notEqual(a.id,captureAssistantContext('#recommend?case=tafeng').id);assert.notEqual(a.id,captureAssistantContext('#forecast?case=uci').id);
 assert.equal(captureAssistantContext('#forecast?case=m5').key,undefined);assert.equal(captureAssistantContext('#delivery').key,undefined);
 assert.deepEqual(Object.keys(a).sort(),['id','key','title']);
});
test('case assistant forwards full conversation, scopes explanation, and directs needs to cooperation',async()=>{
 const history=[{role:'user',content:'我有半年订单'},{role:'assistant',content:'请核对适用条件。'}];
 await runAssistant({mode:'ask',context:'forecast:uci',question:'如果只有一家门店呢',history},{complete:async(messages)=>{
  assert.match(messages[0].content,/需求梳理统一在/);assert.match(messages[0].content,/不声称看到了当前选择/);
  assert.deepEqual(JSON.parse(messages[1].content).untrustedPreviousConversation,history);
  return {message:{content:JSON.stringify({summary:'需验证本店数据，案例不保证新业务收益。',citations:['forecast:uci'],brief:''})}};
 }});
});

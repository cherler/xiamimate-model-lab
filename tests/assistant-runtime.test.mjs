import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import {createStaticServer} from '../scripts/static-server.mjs';
import {createAssistantHandler} from '../services/assistant/http.mjs';
import {runAssistant,providerConfig,validateRequest} from '../services/assistant/runtime.mjs';
const body={mode:'ask',question:'这个案例有什么限制？',context:'forecast:uci'};
const final=(citations=['forecast:uci'])=>({message:{content:JSON.stringify({summary:'已有开发回放，不能承诺新业务收益。',citations,brief:''})},usage:{prompt_tokens:10,completion_tokens:10}});
test('assistant accepts only server evidence citations, preserves usage, and rejects unknown source IDs',async()=>{
 const r=await runAssistant(body,{complete:async()=>final()});assert.equal(r.sources[0].id,'forecast:uci');assert.equal(r.usage.prompt_tokens,10);
 await assert.rejects(runAssistant(body,{complete:async()=>final(['fake-source'])}),/来源/);
 await assert.rejects(runAssistant(body,{complete:async()=>final([])}),/缺少资料引用/);
 await assert.rejects(runAssistant(body,{complete:async()=>({message:{content:'not-json'}})}),/结构化/);
});
test('tool requests cannot execute arbitrary functions and failures remain in the trace',async()=>{
 let n=0;const r=await runAssistant(body,{complete:async()=>++n===1?{message:{tool_calls:[{id:'bad',type:'function',function:{name:'shell',arguments:'{"cmd":"touch x"}'}}]}}:final()});
 assert.equal(r.trace.length,2);assert.equal(r.trace[1].ok,false);assert.match(r.trace[1].result.error,/范围/);
});
test('repeated tool loops terminate without a fake successful answer',async()=>{
 await assert.rejects(runAssistant(body,{complete:async()=>({message:{tool_calls:[{id:'repeat',type:'function',function:{name:'list_cases',arguments:'{}'}}]}})}),/轮次上限/);
});
test('request cannot override model, endpoint, credentials or include research-only context',()=>{
 for(const extra of [{url:'https://attacker.test'},{apiKey:'x'},{context:'forecast:m5'},{question:'a'.repeat(3001)}])assert.throws(()=>validateRequest({...body,...extra}));
 assert.equal(providerConfig({}),null);assert.throws(()=>providerConfig({MODEL_LAB_AI_BASE_URL:'http://external.test/v1',MODEL_LAB_AI_KEY:'secret',MODEL_LAB_AI_MODEL:'model'}));
});
test('optional assistant HTTP rejects cross-origin, bad host, oversize and unconfigured AI; existing static server remains valid',async()=>{
 const server=createStaticServer({root:process.cwd()+'/apps/web',apiHandler:createAssistantHandler({config:null})});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const status=await (await fetch(base+'/api/assistant/status')).json();assert.equal(status.configured,false);
  assert.equal((await fetch(base+'/api/assistant/status',{headers:{Origin:'http://evil.test'}})).status,403);
  assert.equal(await new Promise((resolve,reject)=>{const req=request(base+'/api/assistant/status',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();}),403);
  assert.equal((await fetch(base+'/api/assistant/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,503);
  assert.equal((await fetch(base+'/api/assistant/workflow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'a'.repeat(49000)})})).status,400);
  assert.equal((await fetch(base+'/')).status,200);
 }finally{server.close();await once(server,'close');}
});

test('one format repair keeps failed check, uses final-only mode and accumulates usage',async()=>{
 let n=0;const result=await runAssistant(body,{complete:async(messages,defs,signal,options)=>{
  if(++n===1)return {message:{role:'assistant',content:'这不是 JSON',reasoning_content:'private test reasoning'},usage:{prompt_tokens:5,completion_tokens:3}};
  assert.equal(options.finalOnly,true);assert.equal(messages.at(-2).reasoning_content,'private test reasoning');
  assert.match(messages.at(-1).content,/forecast:uci/);assert.match(messages.at(-1).content,/必须只调用它/);assert.doesNotMatch(messages.at(-1).content,/不调用工具/);return final();
 }});
 assert.equal(n,2);assert.deepEqual(result.validation.map(c=>c.ok),[false,true]);assert.equal(result.validation[0].code,'invalid_json');
 assert.equal(result.usage.prompt_tokens,15);assert.equal(result.usage.completion_tokens,13);assert.doesNotMatch(JSON.stringify(result),/private test reasoning|这不是 JSON/);
});
test('format repair cannot invent citations, retry forever, or invoke another tool',async()=>{
 let n=0;await assert.rejects(runAssistant(body,{complete:async()=>{n++;return final(['fake-source']);}}),e=>e.validation.length===2&&e.validation.every(c=>c.code==='unknown_source'));assert.equal(n,2);
 n=0;await assert.rejects(runAssistant(body,{complete:async()=>++n===1?{message:{content:'broken'}}:{message:{tool_calls:[{id:'x',function:{name:'list_cases',arguments:'{}'}}]}}}),/修正阶段/);
});
test('format repair respects abort and strict object fields',async()=>{
 const c=new AbortController();let n=0;await assert.rejects(runAssistant(body,{signal:c.signal,complete:async()=>{n++;c.abort();return {message:{content:'broken'}};}}),/取消/);assert.equal(n,1);
 const {validateAnswer}=await import('../services/assistant/runtime.mjs');
 for(const answer of [{summary:'x',citations:[],extra:'x'},{summary:'x',citations:[],brief:{}},{summary:'x',citations:[{}]}])assert.throws(()=>validateAnswer(JSON.stringify(answer),new Map()),/格式/);
});

test('context-free Ask AI and retail Agent always receive server-owned evidence first',async()=>{
 const r=await runAssistant({mode:'ask',question:'SASRec 在 UCI 跑了吗？'},{complete:async(messages)=>{assert.match(messages[2].content,/SASRec/);return final(['expand:recommend']);}});
 assert.equal(r.trace[0].name,'list_cases');assert.equal(r.trace[0].phase,'公开案例导航资料');
 const a=await runAssistant({mode:'agent',context:'agent:retail',question:'保证收益吗',selection:{origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5}},{complete:async()=>final(['decision:retail'])});assert.equal(a.trace[0].args.key,'decision:retail');
});

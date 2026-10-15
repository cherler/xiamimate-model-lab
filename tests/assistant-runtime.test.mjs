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

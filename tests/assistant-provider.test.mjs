import test from 'node:test';
import assert from 'node:assert/strict';
import {providerConfig,providerRequest,providerResponse,completionClient} from '../services/assistant/provider.mjs';
import {runAssistant,parseAnswer} from '../services/assistant/runtime.mjs';
const env={MODEL_LAB_AI_BASE_URL:'https://api.minimax.cn/anthropic',MODEL_LAB_AI_KEY:'unit-test-placeholder',MODEL_LAB_AI_MODEL:'MiniMax-M3'},config=providerConfig(env);
const native=[{type:'thinking',thinking:'synthetic test block',signature:'opaque-signature'},{type:'tool_use',id:'call1',name:'list_cases',input:{}}];
test('MiniMax URLs and explicit thinking use the intended protocol and task budget',()=>{
 assert.equal(config.url,'https://api.minimax.cn/anthropic/v1/messages');assert.equal(providerConfig({...env,MODEL_LAB_AI_BASE_URL:env.MODEL_LAB_AI_BASE_URL+'/v1'}).url,config.url);
 const open=providerConfig({...env,MODEL_LAB_AI_BASE_URL:'https://api.minimax.cn/v1'});assert.equal(open.url,'https://api.minimax.cn/v1/chat/completions');
 assert.throws(()=>providerConfig({...env,MODEL_LAB_AI_PROTOCOL:'openai'}));
 for(const c of [config,open]){assert.equal(providerRequest(c,[],[],{mode:'ask'}).thinking.type,'disabled');assert.equal(providerRequest(c,[],[],{mode:'agent'}).thinking.type,'adaptive');const request=providerRequest(c,[],[]);assert.equal(request.max_completion_tokens??request.max_tokens,8192);}
});
test('Anthropic retains all assistant blocks and groups tool results into user content',()=>{
 const m=providerResponse(config,{content:native,stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:20}});
 const r=providerRequest(config,[{role:'system',content:'system'},{role:'user',content:'q'},m.message,{role:'tool',tool_call_id:'call1',content:'{}'},{role:'tool',tool_call_id:'call2',content:'{}'}],[{function:{name:'list_cases',description:'catalog',parameters:{type:'object'}}}]);
 assert.equal(r.system,'system');assert.deepEqual(r.messages[1].content,native);assert.equal(r.messages[2].content.length,2);assert.equal(r.messages[2].content[0].tool_use_id,'call1');assert.equal(r.tools[0].input_schema.type,'object');assert.deepEqual(m.usage,{prompt_tokens:100,completion_tokens:20});
 assert.throws(()=>providerResponse(config,{content:[],stop_reason:'max_tokens'}),/token/);
});
test('real adapter roundtrip preserves native state without leaking it to final response',async()=>{
 let n=0;const payloads=[];
 const complete=completionClient(config,{fetcher:async(url,init)=>{payloads.push(JSON.parse(init.body));return new Response(JSON.stringify(++n===1?{content:native,stop_reason:'tool_use',usage:{input_tokens:12,output_tokens:3}}:{content:[{type:'text',text:JSON.stringify({summary:'公开案例需独立验证。',citations:['catalog'],brief:''})}],stop_reason:'end_turn',usage:{input_tokens:20,output_tokens:4}}));}});
 const r=await runAssistant({mode:'ask',question:'有哪些案例？'},{complete});assert.equal(r.trace[0].name,'list_cases');assert.deepEqual(payloads[1].messages[1].content,native);assert.equal(r.usage.prompt_tokens,32);assert.doesNotMatch(JSON.stringify(r),/synthetic test block|opaque-signature|_anthropic_content/);
});
test('OpenAI adapter preserves separate reasoning in subsequent tool rounds',async()=>{
 let n=0,history;const r=await runAssistant({mode:'ask',question:'列案例'},{complete:async messages=>{history=messages;return ++n===1?{message:{role:'assistant',content:null,reasoning_content:'synthetic separate field',tool_calls:[{id:'c',type:'function',function:{name:'list_cases',arguments:'{}'}}]}}:{message:{content:JSON.stringify({summary:'案例清单',citations:['catalog']})}};}});
 assert.equal(history[2].reasoning_content,'synthetic separate field');assert.doesNotMatch(JSON.stringify(r),/synthetic separate field/);
});

test('a single complete JSON code fence is accepted without accepting surrounding prose',()=>{assert.equal(parseAnswer('```json\n{"summary":"ok"}\n```').summary,'ok');for(const s of ['prefix ```json\n{}\n```','null','[]','```json\n{}\n``` suffix'])assert.throws(()=>parseAnswer(s));});


test('larger output budgets are independent of context and use the M3 completion parameter',()=>{
 const c=providerConfig({...env,MODEL_LAB_AI_BASE_URL:'https://api.minimax.cn/v1',MODEL_LAB_AI_MAX_TOKENS:'32768'}),r=providerRequest(c,[],[]);
 assert.equal(r.max_completion_tokens,32768);assert.equal(r.max_tokens,undefined);
 assert.equal(providerConfig({...env,MODEL_LAB_AI_MAX_TOKENS:'65536'}).maxTokens,65536);
 for(const n of ['1000000','1023','NaN','2048.5'])assert.throws(()=>providerConfig({...env,MODEL_LAB_AI_MAX_TOKENS:n}));
 const other=providerRequest({...c,model:'other-compatible-model'},[],[]);assert.equal(other.max_tokens,32768);assert.equal(other.max_completion_tokens,undefined);
});
test('response byte guard accommodates large reasoning budgets while remaining bounded',async()=>{
 const c=providerConfig({...env,MODEL_LAB_AI_BASE_URL:'https://api.minimax.cn/v1'});
 const fetcher=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'{}',reasoning_content:'x'.repeat(250000)}}]}));
 assert.equal((await completionClient(c,{fetcher})([],[])).message.content,'{}');
 await assert.rejects(completionClient(c,{fetcher:async()=>new Response('x'.repeat(2*1024*1024+1))})([],[]),/响应过大/);
});

test('repair exposes no business tools and M3 OpenAI must use structured submit_answer',async()=>{
 const open={...config,protocol:'openai'};
 const payload=providerRequest(open,[],[{function:{name:'list_cases',parameters:{}}}],{finalOnly:true,mode:'agent'});
 assert.equal(payload.tools.length,1);assert.equal(payload.tools[0].function.name,'submit_answer');assert.equal(payload.tool_choice.function.name,'submit_answer');assert.equal(payload.thinking.type,'disabled');
 assert.equal(providerRequest(config,[],[],{finalOnly:true}).tools,undefined);
 const data={choices:[{message:{tool_calls:[{function:{name:'submit_answer',arguments:'{"summary":"x","citations":[],"brief":""}'}}]}}]};
 assert.equal(JSON.parse(providerResponse(open,data,{finalOnly:true}).message.content).summary,'x');
 assert.equal(providerResponse(open,{choices:[{message:{content:'{}'}}]},{finalOnly:true}).formatMode,'validated_text_required');
 assert.throws(()=>providerResponse(open,{choices:[{message:{tool_calls:[{function:{name:'shell',arguments:'{}'}}]}}]},{finalOnly:true}),/结构化回答工具/);
 const client=completionClient(open,{fetcher:async()=>new Response(JSON.stringify(data))});assert.equal((await client([],[],null,{finalOnly:true})).message.tool_calls,undefined);
});

test('plain text returned despite forced submit is still schema-checked, never silently trusted',async()=>{
 const c={...config,protocol:'openai'};let n=0;
 const complete=completionClient(c,{fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:++n===1?'bad':'{"summary":"无法保证收益。","citations":[],"brief":""}'}}]}))});
 const r=await runAssistant({mode:'ask',question:'保证收益吗'},{complete});assert.equal(r.validation.at(-1).formatMode,'validated_text_required');
 await assert.rejects(runAssistant({mode:'ask',question:'q'},{complete:completionClient(c,{fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:'bad'}}]}))})}),/结构化/);
});

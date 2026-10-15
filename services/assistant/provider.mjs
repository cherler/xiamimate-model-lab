// Protocol adapters preserve native assistant history server-side; only final text reaches UI.
export function providerConfig(env=process.env){
 const {MODEL_LAB_AI_BASE_URL:base,MODEL_LAB_AI_KEY:key,MODEL_LAB_AI_MODEL:model}=env;
 if(!base||!key||!model)return null;
 const url=new URL(base);if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('AI 服务地址必须为 HTTPS 或本机 HTTP');
 const path=url.pathname.replace(/\/$/,''),protocol=env.MODEL_LAB_AI_PROTOCOL||(/\/anthropic(?:\/v1)?$/.test(path)?'anthropic':'openai');
 if(!['anthropic','openai'].includes(protocol))throw new Error('AI 协议仅支持 anthropic 或 openai');
 if(protocol==='openai'&&/\/anthropic(?:\/v1)?$/.test(path))throw new Error('Anthropic 地址不能使用 OpenAI 协议');
 const maxTokens=Number(env.MODEL_LAB_AI_MAX_TOKENS||8192),thinking=env.MODEL_LAB_AI_THINKING||'auto';
 if(!Number.isInteger(maxTokens)||maxTokens<1024||maxTokens>65536)throw new Error('AI 输出上限需在 1024–65536 之间');
 if(!['auto','adaptive','disabled'].includes(thinking))throw new Error('AI thinking 配置无效');
 const endpoint=protocol==='anthropic'?(path.endsWith('/v1')?'/messages':'/v1/messages'):'/chat/completions';
 return {url:url.href.replace(/\/$/,'')+endpoint,key,model,protocol,maxTokens,thinking};
}
function anthropicMessages(messages){
 const result=[];
 for(const m of messages.filter(m=>m.role!=='system')){
  const role=m.role==='tool'?'user':m.role;
  const content=m.role==='tool'?[{type:'tool_result',tool_use_id:m.tool_call_id,content:m.content}]:m._anthropic_content||[
   ...(m.content?[{type:'text',text:m.content}]:[]),
   ...(m.tool_calls||[]).map(t=>({type:'tool_use',id:t.id,name:t.function.name,input:JSON.parse(t.function.arguments)})),
  ];
  if(result.at(-1)?.role===role)result.at(-1).content.push(...content);else result.push({role,content:[...content]});
 }
 return result;
}
export function providerRequest(config,messages,tools,{mode='ask'}={}){
 const m3=config.model==='MiniMax-M3',thinking=m3?{type:config.thinking==='auto'?(mode==='agent'?'adaptive':'disabled'):config.thinking}:null;
 if(config.protocol==='anthropic')return {model:config.model,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),messages:anthropicMessages(messages),
  tools:tools.map(({function:f})=>({name:f.name,description:f.description,input_schema:f.parameters})),tool_choice:{type:'auto'},max_tokens:config.maxTokens,stream:false,...(thinking?{thinking}:{})};
 return {model:config.model,messages:messages.map(({_anthropic_content,...m})=>m),tools,tool_choice:'auto',...(m3?{max_completion_tokens:config.maxTokens}:{max_tokens:config.maxTokens}),stream:false,...(thinking?{thinking,reasoning_split:true}:{})};
}
export function providerResponse(config,data){
 if(data.error||data.base_resp?.status_code)throw new Error('模型服务返回错误，请检查模型权限或配置');
 if(config.protocol==='anthropic'){
  if(!Array.isArray(data.content))throw new Error('Anthropic 模型响应格式不受支持');
  if(data.stop_reason==='max_tokens')throw new Error('模型输出达到 token 上限，未形成完整回答；请缩小任务或调整输出预算');
  const calls=data.content.filter(b=>b.type==='tool_use').map(b=>({id:b.id,type:'function',function:{name:b.name,arguments:JSON.stringify(b.input)}}));
  // Retain thinking/signature/opaque blocks verbatim for the next tool round, never UI/logs.
  return {message:{role:'assistant',content:data.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'),...(calls.length?{tool_calls:calls}:{}),_anthropic_content:data.content},
   usage:data.usage?{prompt_tokens:data.usage.input_tokens,completion_tokens:data.usage.output_tokens}:undefined};
 }
 const choice=data.choices?.[0];if(choice?.finish_reason==='length')throw new Error('模型输出达到 token 上限，未形成完整回答；请缩小任务或调整输出预算');
 if(!choice?.message)throw new Error('OpenAI 兼容模型响应格式不受支持');
 return {message:choice.message,usage:data.usage};
}
export function completionClient(config,{fetcher=fetch}={}){
 return async(messages,tools,signal,options={})=>{
  const response=await fetcher(config.url,{method:'POST',redirect:'error',signal,headers:{'Authorization':`Bearer ${config.key}`,'Content-Type':'application/json',...(config.protocol==='anthropic'?{'anthropic-version':'2023-06-01'}:{})},body:JSON.stringify(providerRequest(config,messages,tools,options))});
  if(!response.ok)throw new Error(`模型服务请求失败（HTTP ${response.status}），请检查配置或额度。`);
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw new Error('模型响应过大');}chunks.push(value);}}finally{reader.releaseLock();}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('模型服务未返回有效 JSON');}
  return providerResponse(config,data);
 };
}

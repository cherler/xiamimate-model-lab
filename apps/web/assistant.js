import {captureAssistantContext} from './assistant-context.js';
import {createAssistantSession} from './assistant-session.js';
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import {assistantRequest} from './assistant-client.js';
export {assistantRequest} from './assistant-client.js';
export function sourcesHtml(sources=[]){return `<nav class="assistant-sources" aria-label="本次回答来源">${sources.filter(s=>/^#(?:recommend|forecast|classify|retrieve|anomaly|segments|decision|expand|delivery|agent)(?:\?|$)/.test(s.href)).map(s=>`<a href="${esc(s.href)}">${esc(s.title)}</a>`).join('')}</nav>`;}
const TOOL_LABELS={list_cases:'查询公开案例',read_case:'读取案例证据',read_expansion:'读取扩展规划',retail_options:'读取可用场景',retail_compare:'读取订单并复算场景成本',retail_review:'复算事后模拟'};
export function traceHtml(trace=[]){return trace.length?`<details class="assistant-trace"><summary>实际工具执行记录（${trace.length} 次）</summary><ol>${trace.map(t=>`<li><strong>${esc(TOOL_LABELS[t.name]||t.name)} · ${t.ok?'完成':'失败'} · ${esc(t.ms)} ms</strong><details><summary>参数与返回内容</summary><pre>${esc(JSON.stringify({phase:t.phase||'模型选择工具',parameters:t.args,result:t.result},null,2))}</pre></details></li>`).join('')}</ol></details>`:'';}
export function validationHtml(checks=[]){return checks.some(c=>!c.ok||c.corrected||c.warning)?`<details class="assistant-trace"><summary>回答校验与修正记录</summary><ul>${checks.map(c=>`<li>第 ${esc(c.attempt)} 次：${(c.corrected||c.warning)?esc(c.message):c.ok?'通过校验':esc(c.message)}</li>`).join('')}</ul><p class="small-note">格式、引用及部分金额日期检查不代表所有解释正确；原失败记录保留。</p></details>`:'';}
export function answerHtml(r){return `<section class="assistant-answer"><h3>${r.mode==='workflow'?'固定流程说明':r.answerOrigin==='tool_report'?'工具计算结论':'AI 解释 · 请结合来源核对'}</h3><p class="assistant-prose">${esc(r.summary)}</p>${sourcesHtml(r.sources)}<p class="small-note">${r.model?`模型：${esc(r.model)} · `:''}本次总耗时 ${esc(r.ms)} ms${r.usage?` · 输入 ${esc(r.usage.prompt_tokens)} / 输出 ${esc(r.usage.completion_tokens)} tokens`:' · 无语言模型用量或服务未提供统计'}。未配置单价，不估算费用。</p>${traceHtml(r.trace)}${validationHtml(r.validation)}</section>`;}
export function initAssistant(){
 const dialog=document.createElement('dialog');dialog.id='ai-dialog';dialog.className='ai-dialog';dialog.setAttribute('aria-labelledby','ai-heading');document.body.append(dialog);
 const sessions=new Map();let active=null,context=null,statusController=null,epoch=0,configured=false;
 const cancel=()=>{epoch++;statusController?.abort();active?.cancel();};
 const draw=()=>{
  const state=active.state,busy=!!state.pending;
  dialog.querySelector('#ai-question').value=state.draft;dialog.querySelector('#ai-question').disabled=busy;
  dialog.querySelector('#ai-send').disabled=busy||!configured;dialog.querySelector('#ai-cancel').hidden=!busy;
  dialog.querySelector('#ai-status').textContent=busy?'正在查阅案例资料并回答…':state.error;
  const log=dialog.querySelector('#ai-answer');log.innerHTML=state.turns.map(t=>`<article class="ai-turn"><p class="ai-user"><strong>你</strong><br>${esc(t.question)}</p>${answerHtml(t.result)}</article>`).join('');
 };
 document.querySelector('#ask-ai').onclick=async()=>{
  cancel();const token=epoch;context=captureAssistantContext(location.hash);if(!sessions.has(context.id))sessions.set(context.id,createAssistantSession());active=sessions.get(context.id);configured=false;
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="ai-heading">问 AI</h2><button class="icon-button" id="ai-close" aria-label="关闭问 AI">×</button></div><p><strong>本次讨论：${esc(context.title)}</strong></p><p class="small-note">帮助理解案例的方法、效果与适用条件。仅发送本案例问答和公开资料，不读取当前样本或页面参数。关闭后保留，刷新清除；请勿粘贴敏感数据。</p><p id="ai-availability" role="status">正在检查服务…</p><div class="assistant-prompts"><button type="button" class="outline" data-question="请简要解释这个案例的方法、整体效果与限制。">解释案例结论</button><button type="button" class="outline" data-question="这个方法适合什么业务，需要哪些条件？">判断适用条件</button><button type="button" class="outline" id="ai-new">新对话</button></div><div id="ai-answer" aria-label="问 AI 对话记录"></div><form id="ai-form"><label for="ai-question">继续提问</label><textarea id="ai-question" rows="3" maxlength="3000" required></textarea><div class="download-actions"><button class="primary" type="submit" id="ai-send" disabled>发送问题</button><button class="outline" type="button" id="ai-cancel" hidden>取消回答</button></div></form><p id="ai-status" role="status" aria-live="polite"></p><p><a href="#delivery?section=start" id="ai-cooperation">有定制需求？前往方案与合作</a>。在合作页直接描述业务问题，已有需求草稿会保留。</p>`;
  dialog.showModal();draw();dialog.querySelector('#ai-close').onclick=()=>dialog.close();dialog.querySelector('#ai-cooperation').onclick=()=>dialog.close();
  dialog.querySelector('#ai-question').oninput=e=>{active.state.draft=e.target.value;};
  dialog.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{if(active.state.pending)return;active.state.draft=b.dataset.question;draw();dialog.querySelector('#ai-question').focus();});
  dialog.querySelector('#ai-cancel').onclick=()=>{active.cancel();draw();};
  dialog.querySelector('#ai-new').onclick=()=>{active.reset();draw();dialog.querySelector('#ai-question').focus();};
  dialog.querySelector('#ai-form').onsubmit=async e=>{
   e.preventDefault();const session=active,scope=context;let request;
   try{request=session.begin();}catch(error){session.state.error=error.message;draw();return;}draw();
   try{const r=await assistantRequest('run',{mode:'ask',question:request.question,history:request.history,...(scope.key?{context:scope.key}:{})},request.controller.signal);
    if(session.accept(request,r)&&dialog.open&&active===session&&epoch===token){draw();dialog.querySelector('#ai-answer .ai-turn:last-child')?.scrollIntoView({block:'start'});}
   }catch(error){if(session.fail(request,error)&&dialog.open&&active===session&&epoch===token)draw();}
  };
  statusController=new AbortController();try{const s=await assistantRequest('status',null,statusController.signal);if(!dialog.open||epoch!==token)return;configured=!!s.configured;dialog.querySelector('#ai-availability').textContent=configured?`已接通配置：${s.model}。回答请结合来源核对。`:'AI 未配置，已有案例仍可浏览。';draw();}catch(e){if(dialog.open&&epoch===token){dialog.querySelector('#ai-availability').textContent=e.message;draw();}}
 };
 dialog.addEventListener('close',cancel);
 dialog.addEventListener('click',e=>{if(e.target.closest('.assistant-sources a'))dialog.close();});
 for(const event of ['hashchange','selectionchange'])window.addEventListener(event,()=>{if(dialog.open&&captureAssistantContext(location.hash).id!==context.id)dialog.close();});
}

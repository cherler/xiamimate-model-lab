import {CASE_READINGS} from './case-reading.js';
import {navigationContext} from './navigation-state.js';
import {resolveRoute} from './case-navigation.js';
import {setBriefDraft} from './cooperation.js';
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function assistantRequest(path,body,signal){
 if(location.protocol==='file:')throw new Error('当前为文件预览。请通过本地服务打开；案例静态内容仍可浏览。');
 const r=await fetch(new URL('./api/assistant/'+path,location.href),{signal,method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
 let data;try{data=await r.json();}catch{throw new Error('当前为静态预览，未连接 AI 服务；已有案例和方案整理仍可使用。');}
 if(!r.ok)throw Object.assign(new Error(data.error||'分析服务暂不可用'),{trace:data.trace||[],validation:data.validation||[]});return data;
}
export function sourcesHtml(sources=[]){return `<nav class="assistant-sources" aria-label="本次回答来源">${sources.filter(s=>/^#(?:recommend|forecast|classify|retrieve|anomaly|segments|decision|expand|delivery)(?:\?|$)/.test(s.href)).map(s=>`<a href="${esc(s.href)}">${esc(s.title)}</a>`).join('')}</nav>`;}
const TOOL_LABELS={list_cases:'查询公开案例',read_case:'读取案例证据',read_expansion:'读取扩展规划',retail_options:'读取可用场景',retail_compare:'读取订单并复算场景成本',retail_review:'复算事后模拟'};
export function traceHtml(trace=[]){return trace.length?`<details class="assistant-trace"><summary>实际工具执行记录（${trace.length} 次）</summary><ol>${trace.map(t=>`<li><strong>${esc(TOOL_LABELS[t.name]||t.name)} · ${t.ok?'完成':'失败'} · ${esc(t.ms)} ms</strong><details><summary>参数与返回内容</summary><pre>${esc(JSON.stringify({parameters:t.args,result:t.result},null,2))}</pre></details></li>`).join('')}</ol></details>`:'';}
export function validationHtml(checks=[]){return checks.some(c=>!c.ok)?`<details class="assistant-trace"><summary>回答校验与修正记录</summary><ul>${checks.map(c=>`<li>第 ${esc(c.attempt)} 次：${c.ok?'通过校验':esc(c.message)}</li>`).join('')}</ul><p class="small-note">格式、引用及部分金额日期检查不代表所有解释正确；原失败记录保留。</p></details>`:'';}
export function answerHtml(r){return `<section class="assistant-answer"><h3>${r.mode==='workflow'?'固定流程说明':'AI 解释 · 请结合来源核对'}</h3><p class="assistant-prose">${esc(r.summary)}</p>${sourcesHtml(r.sources)}<p class="small-note">${r.model?`模型：${esc(r.model)} · `:''}本次总耗时 ${esc(r.ms)} ms${r.usage?` · 输入 ${esc(r.usage.prompt_tokens)} / 输出 ${esc(r.usage.completion_tokens)} tokens`:' · 无语言模型用量或服务未提供统计'}。未配置单价，不估算费用。</p>${traceHtml(r.trace)}${validationHtml(r.validation)}</section>`;}
export function initAssistant(){
 const dialog=document.createElement('dialog');dialog.id='ai-dialog';dialog.className='ai-dialog';dialog.setAttribute('aria-labelledby','ai-heading');document.body.append(dialog);
 let controller;document.querySelector('#ask-ai').onclick=async()=>{
  controller?.abort();const route=resolveRoute(location.hash),ctx=navigationContext(route.page,route.params),key=`${ctx.business}:${ctx.caseId}`,c=CASE_READINGS[key],allowed=ctx.mode!=='delivery'&&c&&!c.research;
  const history=[];
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="ai-heading">问 AI</h2><button class="icon-button" id="ai-close" aria-label="关闭问 AI">×</button></div><p>${allowed?`当前资料：${esc(c.name)}`:ctx.business==='agent'?'当前资料：零售分析 Agent':'公开案例与方案咨询'}</p><p class="small-note">可解释案例结论、讨论适用条件或整理需求。逐样本数值请回到案例查看。提问会发送给配置的大模型服务；请只描述问题，不粘贴原始业务数据。</p><p id="ai-availability" role="status">正在检查服务…</p><div class="assistant-prompts"><button type="button" class="outline" data-question="这个案例能体现什么建模能力？它的结论在什么情况下不可靠？">解释当前案例</button><button type="button" class="outline" data-question="我该提供哪些业务条件，才能判断这个方法是否适合？">判断适用条件</button><button type="button" class="outline" data-question="请帮我整理项目需求摘要。还需要我说明哪些信息？">整理需求</button></div><form id="ai-form"><label for="ai-question">你的问题</label><textarea id="ai-question" rows="4" maxlength="3000" required></textarea><button class="primary" type="submit" disabled>提问</button></form><div id="ai-answer" aria-live="polite"></div><p><a href="#delivery?section=start" id="ai-cooperation">前往方案与合作，整理需求或联系</a></p>`;
  dialog.showModal();dialog.querySelector('#ai-close').onclick=()=>dialog.close();dialog.querySelector('#ai-cooperation').onclick=()=>dialog.close();
  dialog.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{dialog.querySelector('#ai-question').value=b.dataset.question;dialog.querySelector('#ai-question').focus();});
  const form=dialog.querySelector('#ai-form'),button=form.querySelector('button'),availability=dialog.querySelector('#ai-availability'),answer=dialog.querySelector('#ai-answer');
  controller=new AbortController();try{const s=await assistantRequest('status',null,controller.signal);if(!dialog.open)return;availability.textContent=s.configured?`服务已配置：${s.model}。首次调用仍需验证服务可用性。`:'AI 服务尚未配置。可以继续查看案例证据，或在“方案与合作”手工整理需求。';button.disabled=!s.configured;}catch(e){if(e.name!=='AbortError')availability.textContent=e.message;}
  form.onsubmit=async e=>{e.preventDefault();controller?.abort();controller=new AbortController();button.disabled=true;answer.textContent='正在查阅资料并回答…';
   try{const r=await assistantRequest('run',{mode:'ask',question:dialog.querySelector('#ai-question').value,history:history.slice(-4),...(allowed?{context:key}:{})},controller.signal);if(!dialog.open)return;history.push({role:'user',content:dialog.querySelector('#ai-question').value.slice(0,1500)},{role:'assistant',content:r.summary.slice(0,1500)});answer.innerHTML=answerHtml(r);
    if(r.brief){const preview=document.createElement('textarea');preview.value=r.brief;preview.rows=8;preview.setAttribute('aria-label','AI 整理的需求摘要');answer.append(preview);const transfer=document.createElement('button');transfer.className='outline';transfer.textContent='带到方案与合作继续编辑';transfer.onclick=()=>{setBriefDraft(preview.value);dialog.close();location.hash='#delivery?section=start';};answer.append(transfer);}
   }catch(e){if(e.name!=='AbortError'){answer.innerHTML=`<p>${esc(e.message)}</p>${traceHtml(e.trace)}${validationHtml(e.validation)}`;}}finally{button.disabled=false;}
  };
 };
 dialog.addEventListener('close',()=>controller?.abort());
 dialog.addEventListener('click',e=>{if(e.target.closest('.assistant-sources a'))dialog.close();});
}

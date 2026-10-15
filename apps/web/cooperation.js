import {assistantRequest} from './assistant-client.js';
import {deliveryCaseLinks} from './case-reading.js';
export const BRIEF_FIELDS=[['goal','业务问题','现在需要做什么判断？现有做法遇到了什么问题？'],['output','预期输出','例如：每天的商品补货建议，供采购人员审核。'],['data','现有数据条件','有哪些字段、覆盖多久、更新频率？不确定可写待评估。'],['constraints','业务约束','例如：预算、响应时间、人工审核要求、系统环境。'],['success','验收目标','与什么现有方案比较？希望改善哪项指标？'],['delivery','期望合作范围','可行性评估、模型原型、系统接入或教学辅导。']];
let draft={},summary='',description='',pending=null; // In-memory only; navigating between cases does not upload a brief.
export function setBriefDraft(text){summary=String(text).slice(0,12000);}
export function briefText(values){return '模型工坊 · 项目需求摘要\n\n'+BRIEF_FIELDS.map(([key,label])=>`${label}：${String(values[key]||'待沟通').trim()}`).join('\n\n')+'\n\n公开案例仅供能力评估，项目范围与验收标准需另行确认。';}
export function downloadText(name,text){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function renderCooperation(host,current=()=>true){
 cancelCooperation();
 host.innerHTML=`<div class="breadcrumb">模型工坊 / 方案与合作</div><header class="page-heading"><div><h1>业务建模方案与合作</h1><p>从业务判断、数据条件与验收目标出发，确定值得做的模型和交付范围。</p></div></header><nav class="delivery-toc" aria-label="方案与合作目录"><button class="outline" data-jump="cases">业务场景与案例</button><button class="outline" data-jump="stages">交付与验收</button><button class="primary" data-jump="start">说说业务问题</button></nav>${deliveryCaseLinks()}<section id="delivery-stages" class="report-panel"><h2>交付与验收</h2><p>公开案例展示已完成的能力。新业务需要重新确认数据、基线和评价范围，不能直接套用案例成绩。</p><div class="delivery-options">${[
 ['可行性评估','字段与质量检查、业务任务定义、简单基线、实施建议。','确认输入能否在使用时取得，标签是否可信，以及是否值得进入模型实验。'],
 ['模型与交互原型','模型与运行说明、批量结果或接口样例、同范围对照、失败分析。','固定评估集和指标，同时检查分组表现、运行代价与回退条件。'],
 ['系统接入与交接','按实际环境确定接口、部署、人工审核、更新与监测范围。','依据另行约定的效果、时延和可用性标准验收；上线后的经营效果需要持续验证。']
 ].map(([t,out,accept])=>`<article><h3>${t}</h3><p><strong>交付内容</strong><br>${out}</p><p><strong>验收依据</strong><br>${accept}</p></article>`).join('')}</div><p>项目教学与辅导也可单独讨论。<a href="#learn">查看现有教学拆解</a>。</p></section>${briefEntryHtml()}`;
 const form=host.querySelector('#project-brief'),area=host.querySelector('#brief-summary'),status=host.querySelector('#brief-status'),input=host.querySelector('#brief-description'),entry=host.querySelector('#brief-entry'),preview=host.querySelector('#brief-preview'),feedback=host.querySelector('#brief-feedback'),ai=host.querySelector('#brief-ai'),local=host.querySelector('#brief-local'),availability=host.querySelector('#brief-availability');
 let available=false;
 const showSummary=text=>{summary=text;area.value=text;preview.hidden=false;status.textContent='草稿已整理，请核对。尚未发送给商务联系人。';};
 for(const [key] of BRIEF_FIELDS)form.elements[key].value=draft[key]||'';area.value=summary;input.value=description;preview.hidden=!summary;
 input.oninput=()=>{description=input.value;};form.oninput=()=>{draft=Object.fromEntries(new FormData(form));};area.oninput=()=>{summary=area.value;};
 host.querySelectorAll('[data-brief-example]').forEach(b=>b.onclick=()=>{description=b.dataset.briefExample;input.value=description;input.focus();});
 const controller=new AbortController();pending=controller;
 assistantRequest('status',null,controller.signal).then(s=>{if(!current()||controller.signal.aborted)return;available=!!s.configured;ai.disabled=!available;local.hidden=available;availability.textContent=s.configured?'点击“AI 帮我梳理”后，将这段描述发送给已配置的 AI 服务。请勿填写客户明细、密钥或敏感数据。':'AI 暂未接通。可先生成简单草稿，或直接邮件联系，无需填完整表单。';}).catch(()=>{if(current()&&!controller.signal.aborted){availability.textContent='当前未连接 AI 服务。可生成简单草稿或直接联系。';local.hidden=false;}});
 const setBusy=busy=>{entry.querySelectorAll('textarea,button').forEach(e=>e.disabled=busy);form.querySelectorAll('textarea,button').forEach(e=>e.disabled=busy);area.disabled=busy;ai.disabled=busy||!available;host.querySelector('#brief-cancel').hidden=!busy;};
 entry.onsubmit=async e=>{e.preventDefault();description=input.value.trim();if(!description)return;pending?.abort();const task=new AbortController();pending=task;setBusy(true);feedback.hidden=true;status.textContent='正在根据你的描述整理…';
  try{const r=await assistantRequest('run',briefRequest(description),task.signal);if(!current()||task.signal.aborted||pending!==task)return;
   if(r.brief?.trim())showSummary(r.brief);else status.textContent='AI 还需要澄清。可以补充一句后重新整理，也可直接联系。';
   if(r.summary?.trim()){feedback.textContent=r.summary;feedback.hidden=false;}
  }catch(error){if(current()&&pending===task)status.textContent=task.signal.aborted?'已取消，原有描述和草稿保留。':error.message+'。描述已保留，可稍后重试或直接联系。';}
  finally{if(current()&&pending===task){setBusy(false);if(!task.signal.aborted&&!feedback.hidden)feedback.scrollIntoView({block:'center'});}}
 };
 host.querySelector('#brief-cancel').onclick=()=>pending?.abort();
 local.onclick=()=>{description=input.value.trim();if(!description){input.reportValidity();return;}showSummary(briefText({goal:description}));};
 form.onsubmit=e=>{e.preventDefault();draft=Object.fromEntries(new FormData(form));showSummary(briefText(draft));};
 host.querySelector('#brief-copy').onclick=async()=>{if(!area.value.trim()){status.textContent='请先生成或填写摘要。';return;}try{await navigator.clipboard.writeText(area.value);status.textContent='摘要已复制，尚未发送。';}catch{area.focus();area.select();status.textContent='自动复制不可用，请复制已选中的文字。';}};
 host.querySelector('#brief-download').onclick=()=>{if(!area.value.trim()){status.textContent='请先生成或填写摘要。';return;}downloadText('模型工坊-项目需求摘要.txt',area.value);status.textContent='摘要已下载，尚未发送。';};
 host.querySelector('#brief-clear').onclick=()=>{cancelCooperation();setBusy(false);draft={};summary='';description='';form.reset();input.value='';area.value='';preview.hidden=true;feedback.hidden=true;status.textContent='当前需求已清空。';};
 host.querySelectorAll('[data-jump]').forEach(button=>button.onclick=()=>{const target=host.querySelector('#delivery-'+button.dataset.jump);target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});});
}

export function cancelCooperation(){pending?.abort();pending=null;}
export function briefRequest(text){
 const value=String(text).trim();if(!value||value.length>1800)throw new Error('请用不超过 1800 字描述业务问题');
 return {mode:'brief',question:value};
}
export function briefEntryHtml(){return `<section id="delivery-start" class="report-panel cooperation-entry"><h2>说说你想解决的问题</h2><p>用自己的话说一句就可以，不用先懂模型、准备数据表或确定验收指标。</p><form id="brief-entry"><label for="brief-description">你现在最想改善什么？</label><textarea id="brief-description" rows="3" maxlength="1800" required placeholder="例如：我开了一家网店，补货总靠经验，有些商品经常断货，想知道能不能用历史订单帮忙判断。"></textarea><div class="brief-examples"><span>也可以从一个例子开始：</span>${['想让顾客更容易找到感兴趣的商品。','想预测下周销量，减少缺货和积压。','有很多重复的报表工作，想看看 AI 能帮上什么。'].map(text=>`<button class="outline" type="button" data-brief-example="${text}">${text}</button>`).join('')}</div><div class="download-actions"><button class="primary" type="submit" id="brief-ai" disabled>AI 帮我梳理</button><button class="outline" type="button" id="brief-local" hidden>先生成简单草稿</button></div><p class="small-note" id="brief-availability">正在检查 AI 服务…</p></form><button class="outline" type="button" id="brief-cancel" hidden>取消整理</button><p id="brief-status" role="status" aria-live="polite"></p><p id="brief-feedback" class="brief-feedback assistant-prose" hidden></p><div class="contact-next"><h3>也可以直接聊</h3><p>不必先整理摘要，直接发邮件到 <a href="mailto:xiamimate@xichenze.cn">xiamimate@xichenze.cn</a>，或通过<a href="https://xiamimate.com/about" target="_blank" rel="noopener noreferrer">虾米伙伴联系页的企业微信</a>说说你的问题。</p><p class="small-note">本站不会自动发送需求；邮件由你自行发送。合作范围、周期和费用在了解问题后讨论。</p></div><section id="brief-preview" class="brief-preview" hidden><h3>沟通草稿 · 由你核对</h3><label for="brief-summary">可直接修改，不确定的内容留待沟通</label><textarea id="brief-summary" rows="10" maxlength="12000"></textarea><div class="download-actions"><button class="outline" id="brief-copy">复制草稿</button><button class="outline" id="brief-download">下载草稿</button><button class="outline" id="brief-clear">清空</button></div></section><details class="brief-manual"><summary>我已有详细需求，按条目补充（可选）</summary><form id="project-brief">${BRIEF_FIELDS.map(([key,label,placeholder])=>`<label>${label}<textarea name="${key}" rows="2" maxlength="1500" placeholder="${placeholder}"></textarea></label>`).join('')}<button class="outline" type="submit">整理为沟通草稿</button></form></details><p class="small-note">描述和草稿只保留在当前页面内存中，刷新后清除。仅在你点击 AI 整理时发送描述，不接收原始业务文件。</p></section>`;}

import {BUSINESSES,navigationContext,sectionHref} from './navigation-state.js';
import {CASE_EXERCISES} from './case-exercises.js';
import {mountCaseReading,deliveryCaseLinks} from './case-reading.js';
import { renderDecision } from './decision.js';
import { renderMonitoring } from './monitoring.js';
import { renderRetrieval } from './retrieval.js';
import { renderClassification } from './classification.js';
import { renderMetricLessons } from './metric-lessons.js';
import { renderCaseInfo } from './case-info.js';
import { CASES, VIEW_NAMES, resolveRoute, caseHref, visibleCases } from './case-navigation.js';
import { renderDressipi } from './dressipi.js';
import { renderM5 } from './m5.js';
import { renderAutoML } from './automl.js';
import { renderAdvanced } from './advanced.js';
import { renderModelGuide } from './model-guide.js';
import {sidebarHtml,sidebarTarget} from './sidebar-navigation.js';
import { loadManifest, renderShowcase } from './showcase.js';
import { renderCase, cancelCase } from './real-cases.js';
const main = document.querySelector('#main');
const labels = { decision: '决策优化', anomaly: '异常检测', segments: '零售分群', retrieve: '智能检索', classify: '分类与评分', m5: 'M5 预测案例', automl: 'AutoML 实验室', advanced: '进阶模型实验', recommend: '电商商品推荐', forecast: '销量预测', evidence: '效果报告', models: '模型解读', learn: '教学拆解', delivery: '交付方式' };
function heading(page,title,subtitle) {
  return `<div class="breadcrumb">模型工坊<span>/</span>${labels[page]}</div><div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div></div><div class="prototype-note"><span class="status-dot"></span>公开数据案例 · 展示训练、推理与评估记录；新业务效果需要独立验证。</div>`;
}

function delivery() {
  main.innerHTML = heading('delivery', '定制服务与交付范围', '公开案例展示建模和评估能力。新业务先明确目标与验收，再讨论实现范围。') + `<section class="delivery-path" id="delivery-start"><div class="delivery-path-heading"><h2>怎样开始</h2><p>先描述业务问题，不需要在本站上传数据。</p></div><ol><li><strong>说明目标</strong><p>选一个相近案例，写下需要做出的判断、希望得到的输出和衡量效果的方式。</p></li><li><strong>准备需求清单</strong><p>填写业务目标、现有数据类型和期望交付；文件只下载到本机，不会自动发送。</p><button class="outline contact-open" type="button">下载需求清单</button></li><li><strong>自行发起沟通</strong><p>将简要需求发至 <a href="mailto:xiamimate@xichenze.cn">xiamimate@xichenze.cn</a>。可选择附上清单；请勿在初次邮件中发送原始业务数据。</p><a class="primary" href="mailto:xiamimate@xichenze.cn">写邮件沟通</a><a class="delivery-about" href="https://xiamimate.com/about" target="_blank" rel="noopener noreferrer">也可通过企业微信联系</a></li></ol><p class="delivery-path-note">邮件由你的邮件客户端发送。本站没有在线提交、客户数据接入或自动回复；具体范围与验收在沟通后确定。</p></section><section class="delivery-intro" id="delivery-stages"><h2>可讨论的交付阶段</h2></section><div class="delivery-options">${[['数据可行性评估', '数据条件与实施建议', ['字段与数据质量清单', '业务任务和基线验收口径', '可行性结论与风险']], ['模型与交互原型', '离线原型与评估报告', ['可运行模型与实验记录', '批量结果或接口样例', '基线对照与失败分析']], ['业务接入与交接', '按实际系统另定范围', ['数据更新、降级与日志方案', '部署和效果复核文档', '上线前独立验证要求']]].map(([t, sub, items]) => `<article><h2>${t}</h2><p>${sub}</p><ul>${items.map(x => `<li>${x}</li>`).join('')}</ul></article>`).join('')}</div><p class="delivery-teaching">需要项目教学与辅导，可在邮件中说明；<a href="#learn">教学拆解</a>展示了本站现有的复算方式。</p>${deliveryCaseLinks()}<section class="technical-panel"><div class="section-heading"><h2>推荐案例的本地接口示例</h2><span class="badge">仅推荐示例已实现</span></div><div class="tech-columns"><div><h3>推荐请求</h3><pre>POST /api/v1/recommendations
{
  "customer_id": "new",
  "strategy": "als",
  "limit": 10,
  "exclude_purchased": false
}</pre></div><div><h3>交付时保留的内容</h3><p>请求与模型版本、推荐依据、触发的经营规则、降级原因和运行耗时。对照实验独立保存分组与结果。</p><p class="small-note">此接口属于本地推荐演示，不代表七类案例均已有在线接口。模型工坊作为虾米伙伴的模块化项目独立开发，共享联系入口，尚未接入主站账号、积分或客户数据。</p></div></div></section>`;
  main.querySelector('.prototype-note').insertAdjacentHTML('afterend','<nav class="delivery-toc" aria-label="交付方式目录"><button class="outline" data-delivery-section="start">怎样开始</button><button class="outline" data-delivery-section="stages">交付阶段</button><button class="outline" data-delivery-section="cases">业务场景与案例</button></nav>');
  main.querySelectorAll('[data-delivery-section]').forEach(b=>b.onclick=()=>{const target=main.querySelector(`#delivery-${b.dataset.deliverySection}`);target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});});
  bindContact();
}

function toast(message) { const box = document.querySelector('#toast'); box.textContent = message; box.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 2600); }
function download(filename, content) { const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function bindContact() { document.querySelectorAll('.contact-open').forEach(button => button.onclick = () => document.querySelector('#contact-dialog').showModal()); }
document.querySelector('#close-dialog').onclick = () => document.querySelector('#contact-dialog').close();
document.querySelector('#brief-form').onsubmit = e => { e.preventDefault(); const form = new FormData(e.target); download('模型工坊-定制需求.txt', `模型工坊 · 定制需求清单\n\n业务目标：${form.get('goal')}\n现有数据：${form.get('data')}\n期望交付：${form.get('delivery')}\n\n该文件仅保存在本地，尚未发送。如需沟通，请自行发送至 xiamimate@xichenze.cn。初次沟通无需发送原始业务数据。`); toast('需求清单已下载，邮件需由你自行发送'); };
let routeGeneration = 0;
async function casePage(page, params, token, routeError) {
  const caseId=params.get('case'), entry=CASES[page].find(c=>c.id===caseId),view=params.get('view'), choices=visibleCases(page), hidden=entry&&!choices.some(c=>c.id===caseId);
  main.innerHTML=`<section class="case-picker"><label>选择${page==='forecast'?'预测':'推荐'}案例<select id="case-picker">${routeError?'<option value="" selected disabled>请选择已有案例</option>':''}${hidden?'<option value="" selected disabled>当前链接为本地研究案例</option>':''}${choices.map(c=>`<option value="${c.id}" ${c.id===caseId?'selected':''}>${c.label}</option>`).join('')}</select></label><p>${page==='forecast'?'从门店总量到单件商品，比较真实销量与保存预测。':'从行为与商品属性出发，查看推荐依据与量化评估。'}</p></section>${entry?.views.length>1?`<nav class="case-views" aria-label="案例内容">${entry.views.map(v=>`<a href="${caseHref(page,caseId,v)}" ${view===v?'aria-current="page"':''}>${VIEW_NAMES[v]}</a>`).join('')}</nav>`:''}<div id="case-content"></div>`;
  main.querySelector('#case-picker').onchange=e=>{location.hash=caseHref(page,e.target.value);};
  const content=main.querySelector('#case-content'),current=()=>token===routeGeneration;
  if(routeError){content.innerHTML='<section class="report-panel"><h1>案例不存在</h1><p>这个案例不属于当前任务，请选择已有案例。</p></section>';return;}
  if(view==='data')return renderCaseInfo(content,caseId,page);
  if(caseId==='m5')return renderM5(content,current,params);
  if(caseId==='dressipi')return renderDressipi(content,current,params);
  if(view==='advanced')return renderAdvanced(content,current,{task:page,embedded:true});
  if(view==='selection'||view==='tuning')return renderAutoML(content,current,{task:page,embedded:true});
  content.innerHTML='<p class="loading-copy">正在读取案例结果…</p>';
  try {
    const manifest=await loadManifest();if(!current())return;
    const source=manifest.cases.find(c=>c.id===caseId);
    if(!source)throw new Error('案例尚未导出，请先完成本地训练与核验。');
    if(caseId==='tafeng')await renderShowcase(view==='report'?'evidence':page,content,manifest,source,current);
    else await renderCase(view==='report'?'evidence':page,content,source.run_id,source.report_sha256);
  }catch(error){if(current()){content.innerHTML='<section class="report-panel"><h1>案例暂未就绪</h1><p id="case-error"></p></section>';content.querySelector('#case-error').textContent=error.message;}}
}
const selections=new Map();
let lastBusiness='recommend';
function updateNavigation(){
 const {page,params}=resolveRoute(location.hash),context=navigationContext(page,params);
 if(context.mode!=='delivery'){params.set('case',context.caseId);selections.set(context.business,params.toString());lastBusiness=context.business;}
 const business=context.mode==='delivery'?lastBusiness:context.business;
 const currentParams=context.mode==='delivery'?new URLSearchParams(selections.get(business)||''):params;
 const sidebar=document.querySelector('.sidebar');sidebar.innerHTML=sidebarHtml(page,params,selections);
 sidebar.hidden=context.mode==='delivery';document.querySelector('.shell').classList.toggle('delivery-shell',sidebar.hidden);
 main.dataset.mode=context.mode;
 document.querySelectorAll('[data-section]').forEach(a=>{
  const active=a.dataset.section===context.mode;a.classList.toggle('active',active);
  if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  a.href=sectionHref(a.dataset.section,business,currentParams);
 });
}
async function route() {
 const token=++routeGeneration,{page,params,error}=resolveRoute(location.hash),context=navigationContext(page,params);
 if(['models','learn'].includes(page)){
  params.set('case',context.caseId);params.set('business',context.business);params.delete('topic');
 }
 const canonical=`#${page}${params.size?'?'+params:''}`;
 if(location.hash!==canonical)history.replaceState(null,'',canonical);
 updateNavigation();cancelCase();
 const current=()=>token===routeGeneration,renderParams=new URLSearchParams(params),business=context.business;
 let rendering;
 const tafengLesson=context.mode==='learn'&&context.caseId==='tafeng'&&['recommend','forecast'].includes(business);
 if(context.mode==='delivery')delivery();
 else if(context.mode==='models'&&['recommend','forecast'].includes(business)&&!['m5','dressipi'].includes(context.caseId)){
  if(!renderParams.has('task'))renderParams.set('task',business==='forecast'?'weekly_sales':context.caseId==='uci'?'next_basket':'repurchase');
  rendering=renderModelGuide(main,current,renderParams);
 }else if(tafengLesson){renderParams.set('lesson',business);rendering=renderMetricLessons(main,current,renderParams);}
 else{
  renderParams.set('case',context.caseId);
  if(context.mode==='models')renderParams.set('view','models');
  if(context.mode==='learn'){
   renderParams.set('view',CASE_EXERCISES[`${business}:${context.caseId}`]?.view||'experience');renderParams.set('walk','calculation');
  }
  if(CASES[business])rendering=casePage(business,renderParams,token,error);
  else if(business==='decision')rendering=renderDecision(main,current,renderParams);
  else if(['anomaly','segments'].includes(business))rendering=renderMonitoring(main,current,renderParams,business);
  else if(business==='retrieve')rendering=renderRetrieval(main,current,renderParams);
  else if(business==='classify')rendering=renderClassification(main,current,renderParams);
 }
 document.title=`${labels[business]} · ${context.mode==='case'?'案例体验':labels[context.mode]} · 模型工坊`;window.scrollTo(0,0);
 await rendering;
 if(current()){
  if(context.mode==='case'||context.mode==='learn'&&!tafengLesson)mountCaseReading(main,business,renderParams);
  const targetId=sidebarTarget(page,params),target=targetId?main.querySelector(`#${targetId}`):null;
  if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
  updateNavigation();
 }
}
window.addEventListener('selectionchange',updateNavigation);
window.addEventListener('hashchange', route);
document.querySelector('.skip').onclick = e => { e.preventDefault(); main.focus(); main.scrollIntoView(); };
bindContact(); route();

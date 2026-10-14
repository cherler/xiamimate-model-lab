import { renderRetrieval } from './retrieval.js';
import { renderClassification } from './classification.js';
import { renderMetricLessons } from './metric-lessons.js';
import { renderCaseInfo } from './case-info.js';
import { CASES, VIEW_NAMES, resolveRoute, caseHref } from './case-navigation.js';
import { renderDressipi } from './dressipi.js';
import { renderM5 } from './m5.js';
import { renderAutoML } from './automl.js';
import { renderAdvanced } from './advanced.js';
import { renderModelGuide } from './model-guide.js';
import { loadManifest, renderShowcase } from './showcase.js';
import { renderCase, cancelCase } from './real-cases.js';
const main = document.querySelector('#main');
const labels = { retrieve: '智能检索', classify: '分类与评分', m5: 'M5 预测案例', automl: 'AutoML 实验室', advanced: '进阶模型实验', recommend: '电商商品推荐', forecast: '销量预测', evidence: '效果报告', models: '模型解读', learn: '教学拆解', delivery: '交付方式' };
function heading(page,title,subtitle) {
  return `<div class="breadcrumb">模型工坊<span>/</span>${labels[page]}</div><div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div></div><div class="prototype-note"><span class="status-dot"></span>独立案例项目 · 推荐与销量预测已接入真实公开数据训练；线上业务收益尚未验证。</div>`;
}

function delivery() {
  main.innerHTML = heading('delivery', '定制服务与交付范围', '先定义目标与数据条件，再确定模型、接口和交付范围。') + `<section class="delivery-intro"><h2>可选服务</h2><button class="primary contact-open">整理我的需求</button></section><div class="delivery-options">${[['数据可行性评估', '数据条件与实施建议', ['数据质量与字段梳理', '业务任务与评估口径', '基线结果和实施建议']], ['模型与交互原型', '模型原型与评估报告', ['可运行模型与实验记录', '接口或批量结果样例', '演示页面与评估报告']], ['业务接入与教学', '部署文档与项目讲解', ['数据更新、降级与日志方案', '部署文档与效果复核流程', '项目讲解与实践辅导']]].map(([t, sub, items]) => `<article><h2>${t}</h2><p>${sub}</p><ul>${items.map(x => `<li>${x}</li>`).join('')}</ul></article>`).join('')}</div><section class="technical-panel"><div class="section-heading"><h2>接口形态</h2><span class="badge">本地接口 · 已实现</span></div><div class="tech-columns"><div><h3>推荐请求</h3><pre>POST /api/v1/recommendations
{
  "customer_id": "new",
  "strategy": "als",
  "limit": 10,
  "exclude_purchased": false
}</pre></div><div><h3>交付时保留的内容</h3><p>请求与模型版本、推荐依据、触发的经营规则、降级原因和运行耗时。对照实验独立保存分组与结果。</p><p class="small-note">项目目前完全独立；没有接入主站账号、积分、客户数据或在线联系渠道。</p></div></div></section>`;
  bindContact();
}

function toast(message) { const box = document.querySelector('#toast'); box.textContent = message; box.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 2600); }
function download(filename, content) { const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function bindContact() { document.querySelectorAll('.contact-open').forEach(button => button.onclick = () => document.querySelector('#contact-dialog').showModal()); }
document.querySelector('#close-dialog').onclick = () => document.querySelector('#contact-dialog').close();
document.querySelector('#brief-form').onsubmit = e => { e.preventDefault(); const form = new FormData(e.target); download('模型工坊-定制需求.txt', `模型工坊 · 定制需求摘要\n\n业务目标：${form.get('goal')}\n现有数据：${form.get('data')}\n期望交付：${form.get('delivery')}\n\n该文件仅保存在本地，尚未发送。`); toast('需求摘要已下载，尚未发送'); };
let routeGeneration = 0;
async function casePage(page, params, token, routeError) {
  const caseId=params.get('case'), entry=CASES[page].find(c=>c.id===caseId),view=params.get('view');
  main.innerHTML=`<section class="case-picker"><label>选择${page==='forecast'?'预测':'推荐'}案例<select id="case-picker">${routeError?'<option value="" selected disabled>请选择已有案例</option>':''}${CASES[page].map(c=>`<option value="${c.id}" ${c.id===caseId?'selected':''}>${c.label}</option>`).join('')}</select></label><p>${page==='forecast'?'从门店总量到单件商品，比较真实销量与保存预测。':'从行为与商品属性出发，查看推荐依据与量化评估。'}</p></section>${entry?.views.length>1?`<nav class="case-views" aria-label="案例内容">${entry.views.map(v=>`<a href="${caseHref(page,caseId,v)}" ${view===v?'aria-current="page"':''}>${VIEW_NAMES[v]}</a>`).join('')}</nav>`:''}<div id="case-content"></div>`;
  main.querySelector('#case-picker').onchange=e=>{location.hash=caseHref(page,e.target.value);};
  const content=main.querySelector('#case-content'),current=()=>token===routeGeneration;
  if(routeError){content.innerHTML='<section class="report-panel"><h1>案例不存在</h1><p>这个案例不属于当前任务，请选择已有案例。</p></section>';return;}
  if(view==='data')return renderCaseInfo(content,caseId,page);
  if(caseId==='m5')return renderM5(content,current);
  if(caseId==='dressipi')return renderDressipi(content,current);
  if(view==='advanced')return renderAdvanced(content,current,{task:page,embedded:true});
  if(view==='selection'||view==='tuning')return renderAutoML(content,current,{task:page,embedded:true});
  content.innerHTML='<p class="loading-copy">正在读取案例结果…</p>';
  try {
    const manifest=await loadManifest();if(!current())return;
    const source=manifest.cases.find(c=>c.id===caseId);
    if(!source)throw new Error('案例尚未导出，请先完成本地训练与核验。');
    if(caseId==='tafeng')await renderShowcase(view==='report'?'evidence':page,content,manifest,source,current);
    else await renderCase(view==='report'?'evidence':page,content,source.run_id);
  }catch(error){if(current()){content.innerHTML='<section class="report-panel"><h1>案例暂未就绪</h1><p id="case-error"></p></section>';content.querySelector('#case-error').textContent=error.message;}}
}
function route() {
  const token=++routeGeneration,{page,params,error}=resolveRoute(location.hash);
  const canonical=`#${page}${params.size?'?'+params:''}`;
  if(location.hash!==canonical)history.replaceState(null,'',canonical);
  document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  document.querySelectorAll('[data-section]').forEach(a=>a.classList.toggle('active',a.dataset.section===(['models','learn','delivery'].includes(page)?page:'case')));
  cancelCase();
  if(CASES[page])casePage(page,params,token,error);
  else if(page==='retrieve')renderRetrieval(main,()=>token===routeGeneration,params);
  else if(page==='classify')renderClassification(main,()=>token===routeGeneration,params);
  else if(page==='models')renderModelGuide(main,()=>token===routeGeneration);
  else if(page==='learn')renderMetricLessons(main,()=>token===routeGeneration,params);
  else delivery();
  document.title=`${labels[page]} · 模型工坊`;window.scrollTo(0,0);
}
window.addEventListener('hashchange', route);
document.querySelector('.skip').onclick = e => { e.preventDefault(); main.focus(); main.scrollIntoView(); };
bindContact(); route();

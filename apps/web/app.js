import {renderAntiCheat} from './anticheat.js';
import {renderUplift} from './uplift.js';
import {renderAgent,cancelAgent} from './agent-case.js';
import {initAssistant} from './assistant.js';
import {renderCooperation,cancelCooperation} from './cooperation.js';
import {renderScenarioExpansion} from './scenario-expansion.js';
import {refreshLearningContext} from './learning-context.js';
import {renderUciRecommendationLesson} from './uci-recommendation-lesson.js';
import {navigationContext,sectionHref} from './navigation-state.js';
import {mountCaseReading} from './case-reading.js';
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
const labels = {anticheat:'游戏反外挂',uplift:'营销增量',agent:'AI Agent', decision: '决策优化', anomaly: '异常检测', segments: '零售分群', retrieve: '智能检索', classify: '分类与评分', m5: 'M5 预测案例', automl: 'AutoML 实验室', advanced: '进阶模型实验', recommend: '电商商品推荐', forecast: '销量预测', evidence: '效果报告', expand: '场景扩展', models: '模型解读', learn: '教学拆解', delivery: '方案与合作' };
let routeGeneration = 0;
async function casePage(page, params, token, routeError) {
  const caseId=params.get('case'), entry=CASES[page].find(c=>c.id===caseId),view=params.get('view'), choices=visibleCases(page), hidden=entry&&!choices.some(c=>c.id===caseId);
  main.innerHTML=`<section class="case-picker"><label>选择${page==='forecast'?'预测':'推荐'}案例<select id="case-picker">${routeError?'<option value="" selected disabled>请选择已有案例</option>':''}${hidden?'<option value="" selected disabled>当前链接为本地研究案例</option>':''}${choices.map(c=>`<option value="${c.id}" ${c.id===caseId?'selected':''}>${c.label}</option>`).join('')}</select></label><p>${page==='forecast'?'从门店总量到单件商品，比较真实销量与保存预测。':'从行为与商品属性出发，查看推荐依据与量化评估。'}</p></section>${entry?.views.length>1?`<nav class="case-views" aria-label="案例内容">${entry.views.map(v=>`<a href="${caseHref(page,caseId,v)}" ${view===v?'aria-current="page"':''}>${VIEW_NAMES[v]}</a>`).join('')}</nav>`:''}<div id="case-content"></div>`;
  main.querySelector('#case-picker').onchange=e=>{const route=resolveRoute(location.hash),context=navigationContext(route.page,route.params);location.hash=sectionHref(context.mode,page,new URLSearchParams({case:e.target.value}));};
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
    if(caseId==='uci'&&page==='recommend'&&view==='learn')return renderUciRecommendationLesson(content,current,params,source.run_id,source.report_sha256);
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
 main.dataset.mode=context.mode;main.dataset.business=context.business;main.dataset.case=context.caseId;
 refreshLearningContext(main,context,currentParams);
 document.querySelectorAll('[data-section]').forEach(a=>{
  const active=a.dataset.section===context.mode;a.classList.toggle('active',active);
  if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  a.href=sectionHref(a.dataset.section,business,currentParams);
 });
}
async function route() {
 const token=++routeGeneration,{page,params,error}=resolveRoute(location.hash),context=navigationContext(page,params);
 if(['models','learn','expand'].includes(page)){
  params.set('case',context.caseId);params.set('business',context.business);params.delete('topic');
 }
 const canonical=`#${page}${params.size?'?'+params:''}`;
 if(location.hash!==canonical)history.replaceState(null,'',canonical);
 updateNavigation();cancelCase();cancelAgent();cancelCooperation();
 const current=()=>token===routeGeneration,renderParams=new URLSearchParams(params),business=context.business;
 let rendering;
 const tafengLesson=context.mode==='learn'&&context.caseId==='tafeng'&&['recommend','forecast'].includes(business);
 if(business==='anticheat'&&context.mode!=='delivery')rendering=renderAntiCheat(main,current,renderParams,context.mode);
 else if(business==='uplift'&&context.mode!=='delivery')rendering=renderUplift(main,current,renderParams,context.mode);
 else if(business==='agent'&&context.mode!=='delivery')rendering=renderAgent(main,current,renderParams,context.mode);
 else if(context.mode==='expand')renderScenarioExpansion(main,business,renderParams);
 else if(context.mode==='delivery')renderCooperation(main,current);
 else if(context.mode==='models'&&['recommend','forecast'].includes(business)&&!['m5','dressipi'].includes(context.caseId)){
  if(!renderParams.has('task'))renderParams.set('task',business==='forecast'?'weekly_sales':context.caseId==='uci'?'next_basket':'repurchase');
  rendering=renderModelGuide(main,current,renderParams);
 }else if(tafengLesson){renderParams.set('lesson',business);rendering=renderMetricLessons(main,current,renderParams);}
 else{
  renderParams.set('case',context.caseId);
  if(context.mode==='models')renderParams.set('view','models');
  if(context.mode==='learn'){
   renderParams.set('view',['m5','dressipi'].includes(context.caseId)?'experience':'learn');
  }
  if(CASES[business])rendering=casePage(business,renderParams,token,error);
  else if(business==='decision')rendering=renderDecision(main,current,renderParams);
  else if(['anomaly','segments'].includes(business))rendering=renderMonitoring(main,current,renderParams,business);
  else if(business==='retrieve')rendering=renderRetrieval(main,current,renderParams);
  else if(business==='classify')rendering=renderClassification(main,current,renderParams);
 }
 document.title=context.mode==='delivery'?'方案与合作 · 模型工坊':`${labels[business]} · ${context.mode==='case'?'案例体验':labels[context.mode]} · 模型工坊`; window.scrollTo(0,0);
 await rendering;
 if(current()){
  if(tafengLesson&&!main.querySelector('.case-picker')){
   main.insertAdjacentHTML('afterbegin',`<section class="case-picker"><label>选择${business==='forecast'?'预测':'推荐'}案例<select id="lesson-case-picker">${visibleCases(business).map(c=>`<option value="${c.id}" ${c.id===context.caseId?'selected':''}>${c.label}</option>`).join('')}</select></label><p>切换案例后查看各自的保存结果与计算口径。</p></section>`);
   main.querySelector('#lesson-case-picker').onchange=e=>{location.hash=sectionHref('learn',business,new URLSearchParams({case:e.target.value}));};
  }
  if(context.mode==='case')mountCaseReading(main,business,renderParams);
  const targetId=sidebarTarget(page,params),target=targetId?main.querySelector(`#${targetId}`):null;
  if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
  updateNavigation();
 }
}
window.addEventListener('selectionchange',()=>{updateNavigation();const {page,params}=resolveRoute(location.hash),context=navigationContext(page,params);if(context.mode==='case')mountCaseReading(main,context.business,params,{navigate:false});});
window.addEventListener('hashchange', route);
initAssistant();
document.querySelector('.skip').onclick = e => { e.preventDefault(); main.focus(); main.scrollIntoView(); };
route();

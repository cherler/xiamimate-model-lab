import {CASE_READINGS,canShowReading,caseReading,caseExercise,isPreferenceContext} from './case-reading.js';
import {CASE_EXERCISES} from './case-exercises.js';
import {publicCasePath} from './case-paths.js';
import {sectionHref} from './navigation-state.js';
import {mountModelRoadmap} from './model-roadmap.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function learningContextHtml(business,params,mode){
 const key=`${business}:${params.get('case')}`,c=caseReading(business,params),exercise=caseExercise(business,params),path=publicCasePath(key);
 if(!c||!['models','learn'].includes(mode))return '';
 const q=new URLSearchParams(params);q.delete('experienceView');q.set('view','report');q.delete('business');q.delete('walk');
 const report=`#${business}?${q}`;
 const daily=business==='forecast'&&params.get('case')==='uci'&&params.get('task')==='daily_sales';
 const goal=isPreferenceContext(business,params)?'区分价值接近、商品偏好不同的顾客，并核查可覆盖的人群。':daily?'估计未来 28 天逐日销量，核查尖峰、低估和单品误差；与七天总量任务分别评价。':path?.decision||`${c.input} → ${c.output}`;
 const lessonMetric=daily?'商品日误差与逐窗口汇总':exercise.metric;
 const recipe=daily?'对同一商品日计算两方法绝对误差之差，再汇总相同窗口；商品日 MAE 与七日总量 MAE 的单位不同。':exercise.recipe;
 const question=daily?'解释为什么偏差接近零仍可能有很高的 WAPE，以及为什么周总量成绩不能代替逐日尖峰预测。':exercise.failure;
 const evidence=daily?'在相同的 12 商品、三个 28 天窗口比较 WAPE、MAE、偏差及回退；不能用周预测的增益替代逐日任务证据。':c.evidence;
 return `<section class="learning-context" aria-label="${mode==='models'?'建模能力与证据':'本节计算目标'}"><div><span class="guide-kicker">${mode==='models'?'业务判断':'本节核对'}</span><h2>${mode==='models'?esc(goal):esc(lessonMetric)}</h2><p>${esc(mode==='models'?evidence:recipe)}</p></div><div><strong>${mode==='models'?'迁移到新业务需要':'计算后检查'}</strong><p>${esc(mode==='models'?c.needs:question)}</p><p class="small-note">${mode==='models'?esc(c.limit):'使用保存结果核对计算；单样本、分组与整体成绩分别解释。'}</p></div><nav aria-label="本案例证据与方法"><a href="${esc(report)}">查看同范围完整评估</a><a href="${esc(sectionHref(mode==='models'?'learn':'models',business,params))}">${mode==='models'?'核对计算与失效条件':'查看模型输入与方法'}</a><a href="${esc(sectionHref('case',business,params))}">返回当前案例体验</a>${mode==='models'?'<button class="text-link" type="button" data-roadmap-jump>查看场景扩展与模型选型 ↓</button>':''}</nav></section>`;
}
export function refreshLearningContext(host,context,params){
 host.querySelector('.learning-context')?.remove();
 if(context.mode!=='models')host.querySelector('.model-roadmap')?.remove();
 if(!['models','learn'].includes(context.mode)||!canShowReading(host))return;
 // Preserve honest unavailable states rather than adding a success-looking intro.
 if(/尚未整理/.test(host.querySelector('h1')?.textContent||''))return;
 const heading=host.querySelector('.page-heading,.m5-heading');if(!heading)return;
 const c=CASE_READINGS[`${context.business}:${context.caseId}`];
 const title=context.business==='forecast'&&context.caseId==='uci'&&params.get('task')==='daily_sales'?'UCI 28 天逐日销量预测':c?.name;
 if(title){heading.querySelector('h1').textContent=`${title} · ${context.mode==='models'?'模型解读':'教学拆解'}`;const subtitle=heading.querySelector('p');if(subtitle)subtitle.textContent=context.mode==='models'?'从业务输入、模型方法到同范围证据，判断哪些能力可迁移。':'只核对当前案例的保存结果与计算，不重新训练或改变正式评分口径。';}
 heading.insertAdjacentHTML('afterend',learningContextHtml(context.business,params,context.mode));
 if(context.mode==='models'){
  mountModelRoadmap(host,context.business);
  const jump=host.querySelector('[data-roadmap-jump]');
  if(jump)jump.onclick=()=>{const target=host.querySelector('.model-roadmap');if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'smooth'});}};
 }
 if(context.mode==='learn'){
  const key=`${context.business}:${context.caseId}`,anchor=CASE_EXERCISES[key]?.anchor;
  const target=anchor?host.querySelector(`[data-calculation="${anchor}"]`):null;
  for(let el=target?.parentElement;el&&el!==host;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;
 }
}

import {loadUciReport,uciAttribution} from './uci-static.js';
import {saveSelection} from './navigation-state.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>`${(v*100).toFixed(4)}%`;
export function windowRecall(model){
 const windows=model.windows;
 if(!windows?.length||windows.some(w=>!Number.isFinite(w.recall)||!Number.isFinite(w.users)||w.users<=0))throw new Error('缺少有效的逐窗口指标');
 const equal=windows.reduce((n,w)=>n+w.recall,0)/windows.length;
 if(Math.abs(equal-model.metrics.recall)>1e-9)throw new Error('窗口平均与保存报告不一致');
 return {equal,weighted:windows.reduce((n,w)=>n+w.recall*w.users,0)/windows.reduce((n,w)=>n+w.users,0)};
}
export async function renderUciRecommendationLesson(host,current,params,runId,hash){
 host.innerHTML='<p class="loading-copy">正在核验逐窗口推荐成绩…</p>';
 try{
  const r=await loadUciReport(runId,hash);if(!current())return;
  const models=r.recommendation.models;
  let model=Object.hasOwn(models,params.get('model'))?params.get('model'):r.recommendation.default_model;
  let baseline=Object.hasOwn(models,params.get('baseline'))?params.get('baseline'):'personal_decay';
  const selector=(id,label,value)=>`<label>${label}<select id="${id}">${Object.entries(models).map(([k,v])=>`<option value="${k}" ${value===k?'selected':''}>${esc(v.label||k)}</option>`).join('')}</select></label>`;
  const draw=()=>{
   const focused=host.ownerDocument?.activeElement?.id;
   const a=models[model],b=models[baseline],calc=windowRecall(a);windowRecall(b);
   host.innerHTML=`<div class="breadcrumb">商品推荐 / UCI</div><header class="page-heading"><div><h1>UCI 推荐：逐窗口评分与人群范围</h1><p>从保存的窗口指标复算主指标，区分时间平均、顾客窗口平均与冷启动分层。</p></div></header><div class="lesson-controls">${selector('uci-lesson-model','当前方法',model)}${selector('uci-lesson-baseline','对照方法',baseline)}</div><section class="report-panel"><h2>相同三个窗口的 Recall@10</h2><p>每个窗口先按顾客计算 Recall，再在窗口内平均。正式主指标对三个窗口等权平均；Top 10、允许复购、无探索。</p><div class="table-scroll"><table><thead><tr><th>预测起点</th><th>顾客数</th><th>${esc(a.label)}</th><th>${esc(b.label)}</th><th>差值（百分点）</th></tr></thead><tbody>${a.windows.map(w=>{const base=b.windows.find(v=>v.origin===w.origin);if(!base||base.users!==w.users)throw new Error('两方法评价窗口或人群不一致');return `<tr><td>${esc(w.origin)}</td><td>${w.users}</td><td>${pct(w.recall)}</td><td>${pct(base.recall)}</td><td>${((w.recall-base.recall)*100).toFixed(4)}</td></tr>`;}).join('')}</tbody></table></div><details open><summary data-calculation="recommend:uci">窗口平均与冷启动分层计算</summary><p>正式 Recall = (${a.windows.map(w=>pct(w.recall)).join(' + ')}) ÷ ${a.windows.length} = <strong>${pct(calc.equal)}</strong>。</p><p>若改为按各窗口顾客数加权，得到 ${pct(calc.weighted)}。这是不同的汇总口径，不能替换正式成绩；同一顾客可能在多个窗口出现，顾客窗口数也不是独立顾客数。</p><div class="table-scroll"><table><thead><tr><th>起点</th><th>老客人数 / Recall</th><th>新客人数 / Recall</th></tr></thead><tbody>${a.windows.map(w=>`<tr><td>${esc(w.origin)}</td><td>${w.cohorts.warm.users} / ${pct(w.cohorts.warm.recall)}</td><td>${w.cohorts.cold.users} / ${pct(w.cohorts.cold.recall)}</td></tr>`).join('')}</tbody></table></div><p>新客缺少个人历史，使用热门回退。此处核对保存的汇总值，不从展示样本推算全人群成绩，也不把复购改善解释为未购商品发现能力。</p></details></section><footer class="showcase-source">${uciAttribution()}<p>UCI Online Retail II · ${esc(r.run_id)}。这些开发窗口已用于模型选择，不是新的独立测试。数据来源和许可见本案例数据页。</p></footer>`;
   host.querySelector('#uci-lesson-model').onchange=e=>{model=e.target.value;draw();};
   host.querySelector('#uci-lesson-baseline').onchange=e=>{baseline=e.target.value;draw();};
   if(['uci-lesson-model','uci-lesson-baseline'].includes(focused))host.querySelector('#'+focused)?.focus({preventScroll:true});
   saveSelection('recommend',{case:'uci',task:'next_basket',model,baseline});
  };draw();
 }catch(e){if(current())host.innerHTML=`<section class="report-panel"><h1>推荐计算暂不可用</h1><p>${esc(e.message)}</p></section>`;}
}

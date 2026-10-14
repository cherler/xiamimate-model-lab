import {forecastPairEvidence} from './public-comparison.js';
import {uciData, uciDownload, uciAttribution} from './uci-static.js';
import {productNameHtml, productLabel} from './product-labels.js';
import {renderRoundTwo} from './round-two.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>v==null?'—':`${(v*100).toFixed(2)}%`;
const num=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const state={baseline:'four_week_median',model:null,item:null,origin:null,inventory:100};
let taskRevision=0;
const names={popular:'热门',itemcf:'ItemCF',basket:'最近一单搭配',als:'ALS',ease:'EASE',personal_frequency:'个人高频复购',personal_recent:'个人最近购买',personal_decay:'近期加权复购',hybrid:'ALS＋复购融合'};

function tabs(mode){return `<div class="task-switch" aria-label="预测任务"><button id="task-weekly" class="${mode==='weekly'?'active':''}" aria-pressed="${mode==='weekly'}">7 天总销量 · 每周更新</button><button id="task-daily" class="${mode==='daily'?'active':''}" aria-pressed="${mode==='daily'}">28 天逐日 · 原任务对照</button></div><p class="small-note task-boundary">两项任务的预测目标和更新频率不同，成绩分别比较，不能用两张表的 WAPE 差值宣称提升。</p>`;}
function table(headers,rows){return `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function cards(rows){return `<div class="pending-metrics real-metrics">${rows.map(([label,value,note])=>`<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div>`;}
function weeklyTable(summary,selected){return table(['方法','7日总量 WAPE ↓','MAE / 商品周 ↓','总量偏差','相对零预测误差减少'],Object.entries(summary.models).map(([id,m])=>[`${esc(m.label)}${id===selected?' <span class="badge">当前</span>':''}`,pct(m.metrics.wape),`${num(m.metrics.mae)} 件`,pct(m.metrics.bias),pct(1-m.metrics.wape)]));}
function weeklyChart(s,model,label,baseline){
  const past=Array.from({length:8},(_,i)=>s.history.slice(i*7,i*7+7).reduce((a,b)=>a+b,0));
  const values=[...past,s.actual,s.predictions[baseline],s.predictions[model]],max=Math.max(...values,1)*1.15;
  return `<svg class="weekly-chart" viewBox="0 0 760 280" role="img" aria-label="${esc(s.item)} 的过去八周销量、验证周实际总销量与 ${esc(label)} 预测总量对比"><text x="40" y="18">销量 / 件 · 每柱为完整 7 天</text>${[0,.5,1].map(f=>`<path d="M40 ${232-f*190}H744" stroke="#dce7ee"/><text x="32" y="${236-f*190}" text-anchor="end">${Math.round(f*max)}</text>`).join('')}${values.map((v,i)=>`<rect x="${43+i*63}" y="${232-v/max*190}" width="40" height="${v/max*190}" rx="3" fill="${i<8?'#b6cfd9':i===8?'#17324d':i===9?'#af8038':'#087f9d'}"><title>${num(v)} 件</title></rect><text x="${63+i*63}" y="254" text-anchor="middle">${i<8?s.history_dates[i*7].slice(5):i===8?'实际':i===9?'对照':'当前'}</text>`).join('')}</svg>`;
}
export async function renderRoundThree(page,main,r,isCurrent){
  if(page==='forecast') {
    const params=new URLSearchParams(location.hash.split('?')[1]||'');
    if(params.get('task')==='daily_sales') {
      const revision=++taskRevision;
      return renderRoundTwo('forecast',main,r,()=>isCurrent()&&revision===taskRevision,{navigation:{html:tabs('daily'),bind:container=>{container.querySelector('#task-weekly').onclick=()=>weekly(main,r,isCurrent);container.querySelector('#task-daily').onclick=()=>{};}}});
    }
    return weekly(main,r,isCurrent);
  }
  await renderRoundTwo(page,main,r,isCurrent);
  if(page==='evidence'&&isCurrent()){
    const data=await uciData('diagnostics');if(!isCurrent())return;if(data.run_id!==r.run_id)throw new Error('实验版本已更新，请刷新。');
    main.insertAdjacentHTML('beforeend',diagnostics(r,data.diagnostics));
    main.querySelector('.page-heading').insertAdjacentHTML('afterend',`<div class="report-callout"><strong>第三轮重点：简单个人复购是否胜过 ALS？短期预测是否通过开发筛选？</strong><p>旧任务保持原窗口和商品；新增分组诊断、零预测对照和独立的 7 天总销量实验。<a class="text-link" href="#third-round-diagnostics">跳到误差诊断与短期实验</a></p></div>`);
    // In-page anchor must not enter the app's hash router.
    main.querySelector('a[href="#third-round-diagnostics"]').onclick=e=>{e.preventDefault();main.querySelector('#third-round-diagnostics').scrollIntoView({behavior:'smooth'});};
  }
}
async function weekly(main,r,routeCurrent){
  const revision=++taskRevision;
  const isCurrent=()=>routeCurrent()&&revision===taskRevision;
  const data=await uciData('weekly-forecasts');if(!isCurrent())return;if(data.run_id!==r.run_id)throw new Error('实验版本已更新，请刷新。');
  const summary=data.summary;
  const params=new URLSearchParams(location.hash.split('?')[1]||'');
  if(params.get('task')==='weekly_sales'&&Object.hasOwn(summary.models,params.get('model')))state.model=params.get('model');
  if(!summary.models[state.model])state.model=summary.default_model;
  if(!summary.items.includes(state.item))state.item=summary.items[0];
  if(!summary.origins.includes(state.origin))state.origin=summary.origins[0];
  const daily=()=>{const dayRevision=++taskRevision;return renderRoundTwo('forecast',main,r,()=>routeCurrent()&&dayRevision===taskRevision,{navigation:{html:tabs('daily'),bind:container=>{container.querySelector('#task-weekly').onclick=()=>weekly(main,r,routeCurrent);container.querySelector('#task-daily').onclick=()=>{};}}});};
  const render=()=>{
    if(!isCurrent())return;
    const s=data.series.find(s=>s.item===state.item&&s.origin===state.origin),m=summary.models[state.model],gate=summary.gate;
    const error=Math.abs(s.actual-s.predictions[state.model]);
    main.innerHTML=`<div class="breadcrumb">模型工坊<span>/</span>第三轮 · 短期补货实验</div><div class="page-heading"><div><h1>UCI 周销量预测</h1><p>12 件固定商品 · 每周重新训练 · 12 个起点 · 144 个商品周</p></div><span class="badge">本地 CPU · 开发验证</span></div>${tabs('weekly')}${uciAttribution()}<div class="report-callout ${gate.passed?'':'forecast-caution'}"><strong>LightGBM ${gate.passed?'通过':'未通过'}预设开发筛选</strong><p>相对最强基线 ${esc(summary.models[gate.best_baseline].label)}，WAPE ${gate.wape_gain>=0?'降低':'升高'} ${pct(Math.abs(gate.wape_gain))}；12 个窗口胜出 ${gate.winning_windows} 个。通过也不代表生产可用，尚无独立测试或收益证明。</p></div><div class="forecast-selectors model-selectors"><label>预测模型<select id="weekly-model">${Object.entries(summary.models).map(([id,v])=>`<option value="${id}" ${id===state.model?'selected':''}>${esc(v.label)}</option>`).join('')}</select></label><label>对照方法<select id="weekly-baseline">${Object.entries(summary.models).map(([id,v])=>`<option value="${id}" ${id===state.baseline?'selected':''}>${esc(v.label)}</option>`).join('')}</select></label><label>选择商品<select id="weekly-item">${data.series.filter(s=>s.origin===state.origin).map(s=>`<option value="${esc(s.item)}" ${s.item===state.item?'selected':''}>${esc(s.item)} · ${esc(productLabel(s.name))}</option>`).join('')}</select></label><label>预测起点<select id="weekly-origin">${summary.windows.map(w=>`<option value="${w.origin}" ${w.origin===state.origin?'selected':''}>${w.origin} → ${w.end}</option>`).join('')}</select></label></div><div class="forecast-guide-entry"><span>查看输入特征、训练方式与局限。</span><a class="outline small" href="#models?case=uci&task=weekly_sales&model=${state.model}">解读当前预测模型</a></div><div class="forecast-layout"><section class="chart-panel"><div class="section-heading"><div><h2>${productNameHtml(s.name)}</h2><p class="muted">${esc(s.item)} · ${s.origin} → ${s.end} · ${esc(m.label)}</p></div><span class="badge">7 天总量</span></div>${(s.fallback_models.includes(state.model)||s.fallback_models.includes(state.baseline))?'<p class="fallback-banner">AutoETS 此窗口失败，已明确回退到上周总量；原因保存在报告。</p>':''}${weeklyChart(s,state.model,m.label,state.baseline)}${cards([['验证周实际',`${num(s.actual)} 件`,'实际销量只用于评分'],['所选方法预测',`${num(s.predictions[state.model])} 件`,'只使用起点之前的数据'],['这一商品周绝对误差',`${num(error)} 件`,s.actual>0?`该商品周 WAPE ${pct(error/s.actual)}`:'实际为零，WAPE 不定义']])}<p class="chart-caption">模型输出是完整 7 天的总量，没有把总量均分后伪装成逐日预测，也没有预测区间。历史柱以当前起点向前划分连续 7 天。</p></section><section class="rules-pane forecast-rules"><h2>一周备货情景</h2><p class="small-note">仅覆盖当前完整 7 天；库存是你输入的假设。</p><label for="weekly-inventory">假设现有库存（件）<input id="weekly-inventory" type="number" min="0" max="10000000" value="${state.inventory}"></label><div class="scenario-result"><span>覆盖一周的补货量</span><strong id="weekly-reorder"></strong></div><p class="small-note">规则为 max(0, 预测总量 − 假设库存)，向上取整。没有安全库存、在途量、缺货损失和真实收益核算。</p><p class="small-note">实验 ${esc(r.run_id)}；全部商品及窗口保留，不因成绩差而删选。</p></section></div>${forecastPairEvidence(data.series,s,state.model,state.baseline,Object.fromEntries(Object.entries(summary.models).map(([k,v])=>[k,v.label])),{scope:'全部 12 商品 × 12 个起点',unit:'商品周',caseId:'uci',task:'weekly_sales'})}<section class="report-panel forecast-summary"><h2>相同 144 个商品周上的比较</h2>${weeklyTable(summary,state.model)}<p class="small-note">WAPE = 144 个商品周的绝对误差之和 / 实际总销量。MAE 单位为件／商品周，与原任务的件／商品日不同。相对零预测减少可为负值，表示比全部预测为零还差。</p><details class="selection-details"><summary>查看预设筛选条件与入选参数</summary><p>总量偏差绝对值 ≤20%；相对最强基线 WAPE 改善 ≥10%；至少 8 / 12 窗口胜出。这些只是本轮开发筛选条件，不是通用上线标准。</p><pre>${esc(JSON.stringify({selected_params:summary.selected_params,gate:summary.gate},null,2))}</pre></details><div class="download-actions"><a class="outline" href="${uciDownload(`weekly-predictions.csv.gz`)}" download>下载全部商品周预测</a><a class="text-link" href="#forecast?case=uci&view=report">查看诊断与完整证据</a></div></section>`;
    main.querySelector('#task-daily').onclick=daily;main.querySelector('#task-weekly').onclick=()=>weekly(main,r,routeCurrent);
    for(const [id,key] of [['weekly-baseline','baseline'],['weekly-model','model'],['weekly-item','item'],['weekly-origin','origin']])main.querySelector(`#${id}`).onchange=e=>{state[key]=e.target.value;render();};
    const update=()=>{const raw=Number(main.querySelector('#weekly-inventory').value);state.inventory=Number.isFinite(raw)?Math.max(0,Math.min(10000000,raw)):0;main.querySelector('#weekly-reorder').textContent=`${num(Math.ceil(Math.max(0,s.predictions[state.model]-state.inventory)))} 件`;};
    main.querySelector('#weekly-inventory').oninput=update;update();
  };render();
}
function diagnostics(r,d){
  const chosen=r.recommendation.default_model,base=d.recommendation.overall.als,best=d.recommendation.overall[chosen];
  const groups=d.recommendation.groups;
  const groupRows=key=>groups[key].flatMap(g=>['als','personal_frequency','personal_decay','hybrid'].map(name=>{const m=g.models[name];return [esc(g.group==='cold'?'无可用历史':g.group),names[name],num(m.rows),pct(m.recall),m.ndcg.toFixed(4),pct(m.precision),pct(m.ideal_recall)];}));
  const compareDaily=['zero','ridge','lightgbm','autoets','lgbm_history_l1','lgbm_history_l2','lgbm_history_log'];
  const demandLabels={zero:'零销量日',regular:'常规正销量日',spike:'超过历史95分位的尖峰日'};
  return `<section class="report-panel" id="third-round-diagnostics"><h2>05 / 推荐误差与人群分析</h2>${cards([['ALS 诊断样本 Recall',pct(base.recall),'所有顾客窗口直接平均'],[`${names[chosen]} Recall`,pct(best.recall),'相同诊断样本'],['Top 10 理想上限',pct(best.ideal_recall),'使用真实目标计算，仅用于诊断']])}<p class="small-note">以下诊断按顾客窗口直接平均，和上方“先按窗口平均、再等权合并”的主指标有细微差异。实际购物篮大小、复购／新商品分组是事后诊断，不是预测时可用输入。</p><details class="selection-details" open><summary>按预测前的历史商品数量分组</summary>${table(['历史商品数','策略','样本数','Recall@10','NDCG@10','Precision@10','理想 Recall 上限'],groupRows('activity'))}</details><details class="selection-details"><summary>按实际下一单商品数量分组</summary>${table(['实际商品数','策略','样本数','Recall@10','NDCG@10','Precision@10','理想 Recall 上限'],groupRows('basket'))}</details>${table(['策略','已有商品的召回','首次商品的召回','有复购目标样本','有新商品目标样本'],Object.entries(d.recommendation.overall).map(([id,m])=>[names[id],pct(m.repeat_recall),pct(m.novel_recall),num(m.repeat_users),num(m.novel_users)]))}<p class="small-note">复购/首次商品召回只统计该类目标非空的样本，排名仍然是原始 Top 10；没有重新挑选推荐列表。个人复购基线提升不代表能做好新商品发现。</p></section><section class="report-panel"><h2>06 / 28 天逐日预测的误差归因</h2><p class="small-note">尖峰门槛只用该商品当前起点之前的历史计算；分类时使用验证期实际销量，属于事后诊断。全部商品和订单保留。</p>${table(['日期类型','方法','商品日','WAPE','MAE','占该方法总误差'],d.forecast.by_demand.flatMap(g=>compareDaily.map(name=>{const m=g.models[name];return [demandLabels[g.group],esc(r.forecast.models[name].label),num(g.rows),pct(m.wape),num(m.mae),pct(m.share_of_model_error)];})))}<details class="selection-details"><summary>展开全部 12 件商品的误差，不隐藏困难商品</summary>${table(['货号','零销量占比',...compareDaily.map(n=>esc(r.forecast.models[n].label)+' WAPE')],d.forecast.by_item.map(g=>[esc(g.group),pct(g.zero_fraction),...compareDaily.map(n=>pct(g.models[n].wape))]))}</details><p class="small-note">丰富历史 L1/L2/log-L2 三组使用相同特征和样本，可以比较目标变换的影响；原 LightGBM 为第二轮 Tweedie，不能把与它的差异全部归因于某一个特征。</p></section><section class="report-panel"><h2>07 / 独立任务：7 天总销量</h2>${weeklyTable(r.weekly,r.weekly.default_model)}<p class="small-note">每周更新、预测 7 天总量，共 144 个商品周；与原来每月起点的 28 天逐日任务分别评估。LightGBM ${r.weekly.gate.passed?'通过':'未通过'}预设开发筛选，仍没有独立泛化或商业收益证明。</p><div class="download-actions"><a class="outline" href="${uciDownload(`weekly-predictions.csv.gz`)}" download>商品周预测 CSV</a><a class="outline" href="${uciDownload(`recommendation-diagnostics.csv.gz`)}" download>推荐分组诊断 CSV</a><a class="outline" href="${uciDownload(`diagnostics.json`)}" download>完整诊断 JSON</a><a class="text-link" href="#forecast?case=uci">体验短期补货实验</a></div><p class="small-note">父实验 ${esc(r.parent_run_id)} 的原模型和预测已校验后继承，历史产物保持不变。第三轮新增训练耗时 ${num(r.duration_seconds)} 秒，CPU / 2 线程。</p></section>`;
}

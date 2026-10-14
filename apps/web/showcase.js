import {saveSelection} from './navigation-state.js';
import {forecastPairEvidence,publicApplicability} from './public-comparison.js';
// Read-only public results. Experiment metrics never depend on the selected example.
export const MODEL_NAMES = {
  personal_frequency: '购买日频次', personal_recent: '最近购买', personal_decay_90d: '90 天衰减复购',
  als_decay_25: 'ALS 25%＋衰减复购 75%', popular_excluding_history: '排除已购的热门',
  itemcf_excluding_history: 'ItemCF · 排除已购', als_excluding_history: 'ALS · 排除已购',
  als_category_25: '品类 25%＋ALS 75%', zero: '全零预测', last_week: '上周销量',
  four_week_mean: '四周均值', four_week_median: '四周中位数', autoets: 'AutoETS',
  lgbm_regression_l1_7: 'LightGBM L1 · 7 叶子',
};
const EXPLANATIONS = {
  personal_frequency: '按历史购买日频次排序；同一天的重复交易不重复计数。',
  personal_recent: '优先推荐距离上次购买较近的商品。',
  personal_decay_90d: '历史购买日按 90 天时间衰减加权，越近的购买贡献越大。',
  als_decay_25: '分别归一化 ALS 与衰减复购信号，再以 25%／75% 融合；只在买过的商品中排序。',
  popular_excluding_history: '按训练期不同购买者数量排序，排除该顾客买过的商品。',
  itemcf_excluding_history: '汇总历史商品与候选商品的共购相似度，排除已购。',
  als_excluding_history: '使用历史购买矩阵学习潜在偏好，在未购商品中排序。',
  als_category_25: '归一化品类偏好与 ALS 信号，以 25%／75% 融合，在未购商品中排序。',
  zero: '所有商品预测为零，用于理解误差基准。', last_week: '下一周总量直接沿用最近完整一周销量。',
  four_week_mean: '取起点之前四个完整周销量的均值。', four_week_median: '取起点之前四个完整周销量的中位数。',
  autoets: '用起点之前的日销量拟合统计模型，再将未来七天预测求和。',
  lgbm_regression_l1_7: '使用历史周销量、波动、零销量比例、日期与固定商品特征，直接预测七天总销量。',
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = n => n == null ? '不适用' : `${(n * 100).toFixed(2)}%`;
const num = n => n == null ? '不适用' : Number(n).toLocaleString('zh-CN', {maximumFractionDigits: 2});
const decimal = n => n == null ? '不适用' : n.toFixed(5);
const signed = n => `${n >= 0 ? '+' : ''}${decimal(n)}`;
const state = {historyOrder:'recent',task:'repurchase', models:{}, customer:null, item:null, origin:null, forecastModel:null};
const cache = new Map();
async function jsonFile(path, expected) {
  const key = `${path}:${expected || ''}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const response = await fetch(`./showcase/${path}`);
    if (!response.ok) throw new Error('展示数据暂时无法读取，请重新加载。');
    const bytes = await response.arrayBuffer();
    if (expected) {
      if (!globalThis.crypto?.subtle) throw new Error('请通过 HTTPS 或本机地址访问，以核验展示数据。');
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), n=>n.toString(16).padStart(2,'0')).join('');
      if (actual !== expected) throw new Error('展示数据校验失败，请刷新或联系维护者。');
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  })().catch(error=>{cache.delete(key); throw error;}));
  return cache.get(key);
}
export function loadManifest() { return jsonFile('manifest.json'); }
export async function loadShowcaseResource(manifest, entry, name) {
  const path = entry.resources[name];
  if (!path || !manifest.files[path]) throw new Error('案例资源不完整。');
  const result = await jsonFile(path, manifest.files[path]);
  if (result.run_id !== entry.run_id) throw new Error('案例版本不一致。');
  return result;
}
export function sampleStatus(sample, task, model) {
  if (task === 'repurchase' && sample.cohort === 'cold') return 'inapplicable';
  return sample.tasks[task]?.[model] ? 'scored' : 'unobserved';
}
export function forecastRow(data, item, origin) {
  const row = data.series.find(r=>r.item===item && r.origin===origin);
  if (!row) throw new Error('该商品与时间窗口没有已核验结果。');
  return row;
}
function table(headers, rows, label) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function metric(items) {
  return `<div class="showcase-metrics">${items.map(([label,value,detail])=>`<div><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`).join('')}</div>`;
}
function title(entry, text, subtitle) {
  return `<div class="breadcrumb">公开数据案例<span>/</span>Ta Feng</div><div class="page-heading"><div><h1>${text}</h1><p>${subtitle}</p></div><span class="badge">独立留出测试</span></div><p class="showcase-boundary">已训练模型结果回放 · 2001 年 2 月测试 · 固定评估规则 · 不代表线上转化或收益</p>`;
}
function source(entry) {
  return `<footer class="showcase-source"><p>数据：<a href="https://www.kaggle.com/datasets/chiranjivdas09/ta-feng-grocery-dataset" target="_blank" rel="noreferrer">Ta Feng，Kaggle 版本 1</a>，发布者声明 CC0；本项目未独立核验原零售商完整权利链。仅展示公开历史记录与离线结果。</p><p>初始训练：2000 年 11—12 月；开发：2001 年 1 月；最终测试：2001 年 2 月。最终推荐拟合使用 2 月 1 日前全部历史；测试前冻结选型，预测每周可使用当时已发生的数据重训。实验 ${esc(entry.run_id)}。</p><a class="text-link" href="./showcase/${esc(entry.resources.report)}" download>下载本次完整实验报告</a></footer>`;
}
function modelLabel(name, decision) {
  return `${esc(MODEL_NAMES[name] || name)}${name===decision.selected_model?'<span class="table-tag">开发期冻结模型</span>':''}${name===decision.baseline?'<span class="table-tag">冻结基线</span>':''}`;
}
function comparison(report, task) {
  const c=report.comparisons[task], d=report.decisions[task], interval=c.paired_ndcg;
  const rec=task!=='weekly_sales';
  return `<div class="showcase-verdict ${c.gain_screen_passed?'passed':'failed'}"><strong>${c.gain_screen_passed?'通过本次预设增益筛选':'未通过本次预设增益筛选'}</strong><p>${rec?`${esc(MODEL_NAMES[d.selected_model])} 相对 ${esc(MODEL_NAMES[d.baseline])}，NDCG 差值 ${signed(interval.difference)}；95% 配对区间 [${signed(interval.low)}, ${signed(interval.high)}]。`:`LightGBM 相对冻结中位数基线的 WAPE 降低 ${pct(c.relative_wape_gain)}，${c.winning_windows}／4 周胜出，但总量偏差为 ${pct(report.weekly[d.selected_model].metrics.bias)}。`}</p><small>${rec?'筛选要求：NDCG 增加至少 0.01，且配对区间下界大于 0。区间仅描述本次测试顾客的差异，不保证未来月份。':'筛选要求：WAPE 相对改善至少 10%、绝对偏差不超过 20%、至少 3／4 周胜出。上周销量基线的 WAPE 与偏差均优于 LightGBM。'}</small></div>`;
}
function recTable(report, task, selected) {
  const d=report.decisions[task];
  return table(['方法','NDCG@10 ↑','条件 Recall@10 ↑','Precision@10 ↑','命中率 ↑','目录覆盖 ↑'],Object.entries(report.recommendation[task]).map(([name,{warm:m}])=>`<tr class="${name===selected?'selected-row':''}"><td>${modelLabel(name,d)}</td><td>${decimal(m.ndcg)}</td><td>${pct(m.recall)}</td><td>${pct(m.precision)}</td><td>${pct(m.hit_rate)}</td><td>${pct(m.catalog_coverage)}</td></tr>`),'推荐方法完整人群比较');
}
function items(list, ranked=[]) {
  const hits = new Set(ranked);
  return list.length ? `<ul class="item-chips">${list.map(id=>`<li class="${hits.has(id)?'hit':''}">${esc(id)}${hits.has(id)?' · 命中':''}</li>`).join('')}</ul>` : '<p class="small-note">无此类商品</p>';
}
export function sortedHistory(sample, order='recent') {
  return [...sample.history].sort((a,b)=>{
    const x=sample.behavior?.[a], y=sample.behavior?.[b];
    if(!x || !y) return x?-1:y?1:a.localeCompare(b);
    return (order==='frequency'?y.purchase_days-x.purchase_days || x.days_since_last-y.days_since_last:x.days_since_last-y.days_since_last || y.purchase_days-x.purchase_days) || a.localeCompare(b);
  });
}
export function exampleComparison(row, baseline) {
  if(!row || !baseline) return null;
  const hits=r=>r.ranked.filter(id=>r.target.includes(id)).length;
  return {currentHits:hits(row), baselineHits:hits(baseline), targets:row.target.length,
    ndcgDifference:row.ndcg-baseline.ndcg,
    missed:row.target.filter(id=>!row.ranked.includes(id))};
}
function behaviorText(sample,id) {
  const info=sample.behavior?.[id];
  if(info) return `买过 ${info.purchase_days} 个购物日 · 距上次 ${info.days_since_last} 天`;
  return sample.history.includes(id)?'曾购买；该商品未进入模型目录，未保存频次与最近日期':'预测前没有购买记录';
}
function rankList(sample,row,other,kind) {
  if(!row) return '<p class="small-note">没有已保存的评分输出</p>';
  return `<ol class="behavior-ranking">${row.ranked.map((id,index)=>{
    const before=other?.ranked.indexOf(id)??-1;
    const change=kind==='current'?(before<0?'基线未进前 10':before===index?'与基线名次相同':`基线第 ${before+1} → 当前第 ${index+1}`):`基线第 ${index+1}`;
    return `<li class="${row.target.includes(id)?'hit':''}"><button type="button" data-item="${esc(id)}" aria-pressed="false"><span class="behavior-item-title">商品 ${esc(id)} <em>${row.target.includes(id)?'实际命中':'未命中'}</em></span><span>${esc(behaviorText(sample,id))}</span><small>${change}</small></button></li>`;
  }).join('')}</ol>`;
}
function behaviorWorkbench(sample,task,model,d,status,row) {
  const baseline=sample.tasks[task]?.[d.baseline], result=exampleComparison(row,baseline);
  const ids=sortedHistory(sample,state.historyOrder);
  const inactive=status==='inapplicable'?'新顾客没有历史，复购任务不适用。可切换到新商品发现查看热门回退。':'该训练期顾客在测试月没有回访记录，没有保存的评分输出。';
  let observation='';
  if(result) {
    observation=model===d.baseline?'当前选择就是冻结基线，两列结果相同。':result.targets===0?'本购物日没有本任务目标，个例 Recall 不适用；不能由此判断模型更有效。':
      result.currentHits===result.baselineHits?`两种方法都命中 ${result.currentHits}／${result.targets} 件。${Math.abs(result.ndcgDifference)<1e-12?'命中数与 NDCG 均相同，本样本没有显示额外增益。':`命中数相同，排序位置不同；NDCG 差值 ${signed(result.ndcgDifference)}。`}`:
      `冻结基线命中 ${result.baselineHits}／${result.targets} 件，当前方法命中 ${result.currentHits}／${result.targets} 件；NDCG 差值 ${signed(result.ndcgDifference)}。`;
  }
  return `<section class="behavior-workbench"><article class="behavior-history"><h2>预测起点前的购买记录</h2><p class="small-note">起点 2001-02-01 前，${sample.history.length} 件不同商品。天数均相对预测起点计算。</p><label class="behavior-sort">排列历史<select id="tf-history-order"><option value="recent" ${state.historyOrder==='recent'?'selected':''}>最近购买优先</option><option value="frequency" ${state.historyOrder==='frequency'?'selected':''}>购买频次优先</option></select></label><div class="behavior-history-list" tabindex="0" role="region" aria-label="购买行为历史">${ids.length?ids.map(id=>`<button type="button" class="behavior-history-item" data-history-item="${esc(id)}" data-item="${esc(id)}" aria-pressed="false"><strong>商品 ${esc(id)}</strong><span>${esc(behaviorText(sample,id))}</span><small>${sample.behavior?.[id]?`最近购买 ${sample.behavior[id].last_purchase_date}`:'完整历史中保留，统计未保存'}</small></button>`).join(''):'<p class="showcase-empty">没有预测前购买历史</p>'}</div></article><div class="behavior-comparison"><div class="behavior-link-note" aria-live="polite" id="tf-linked-detail">点击任一商品，同步查看历史与两种方法的排序。</div>${status==='scored'?`<div class="behavior-outcome"><strong>${observation}</strong><p>${sample.cohort==='cold'?'两种方法均实际执行同一热门回退。 ':''}这是个例结果；整体增益见下方完整人群评估。购买频次和最近购买是行为证据，不是对 ALS 潜在因素的因果解释。</p></div><div class="behavior-duel"><article><h2>冻结基线</h2><p>${esc(MODEL_NAMES[d.baseline])}</p>${rankList(sample,baseline,row,'baseline')}</article><article><h2>当前模型</h2><p>${esc(MODEL_NAMES[model])}</p>${rankList(sample,row,baseline,'current')}</article></div>`:`<p class="showcase-empty">${inactive}</p>`}<article class="behavior-actual"><h2>${task==='repurchase'?'后来实际复购':'后来实际首次购买'}</h2><p class="small-note">仅展示下一购物日中属于本任务的商品，实际结果只用于评分。</p>${status==='scored'?`<div class="behavior-targets">${row.target.map(id=>`<button type="button" data-item="${esc(id)}" aria-pressed="false" class="${row.ranked.includes(id)?'hit':'miss'}">商品 ${esc(id)}<small>${row.ranked.includes(id)?'当前方法命中':'当前方法漏掉'}</small></button>`).join('') || '<span>本购物日无此类目标</span>'}</div><p class="small-note">目标 ${row.target_count} 件；当前命中 ${result.currentHits} 件，漏掉 ${result.missed.length} 件。其中 ${row.oov_targets} 件目标不在训练目录，仍保留在分母中。</p>${metric([['基线 NDCG@10',decimal(baseline.ndcg),'仅此顾客'],['当前 NDCG@10',decimal(row.ndcg),'仅此顾客'],['当前 Recall@10',pct(row.recall),row.target.length?'仅本任务目标':'目标为空，不定义']])}`:'<p class="small-note">本任务无可评分结果</p>'}</article></div></section>`;
}
function bindBehavior(host,sample,rerender) {
  host.querySelector('#tf-history-order').onchange=e=>{state.historyOrder=e.target.value;rerender();host.querySelector('#tf-history-order').focus();};
  host.querySelectorAll('[data-item]').forEach(button=>button.onclick=()=>{
    const id=button.dataset.item;
    host.querySelectorAll('[data-item]').forEach(el=>{const active=el.dataset.item===id;el.classList.toggle('linked-item',active);el.setAttribute('aria-pressed',String(active));});
    const info=sample.behavior?.[id];
    host.querySelector('#tf-linked-detail').textContent=`商品 ${id}：${behaviorText(sample,id)}${info?`，最近购买 ${info.last_purchase_date}`:''}。`;
    const history=Array.from(host.querySelectorAll('[data-history-item]')).find(el=>el.dataset.historyItem===id);
    if(history) { const list=history.parentElement; list.scrollTop=history.offsetTop; }
  });
}

function recommendation(host, report, data, entry) {
  const task=state.task, d=report.decisions[task];
  const model=state.models[task] ||= d.selected_model;
  const sample=data.samples.find(s=>s.customer===state.customer) || data.samples[0]; state.customer=sample.customer;
  saveSelection('recommend',{case:'tafeng',task,model,customer:sample.customer});
  const status=sampleStatus(sample,task,model), row=sample.tasks[task]?.[model];
  const summary=report.recommendation[task][model].warm;
  host.innerHTML=title(entry,'Ta Feng 商品推荐','将老客复购与未购商品发现分开比较；同一任务中，每个方法面对相同的评估人群。')+
    `<div class="task-switch" aria-label="推荐任务">${[['repurchase','老客复购'],['discovery','新商品发现']].map(([id,label])=>`<button data-task="${id}" class="${task===id?'active':''}" aria-pressed="${task===id}">${label}</button>`).join('')}</div><p class="task-boundary small-note">${task==='repurchase'?'只从历史买过且在训练目录内的商品中推荐；候选不足 10 件时不以未购商品补满。':'只从顾客没有买过的训练目录商品中推荐；“新”指对顾客而言未购，并非刚上市。'} 目标为下一购物日的购物篮，不是下一张订单。</p>`+
    `<section class="showcase-controls"><label>公开样本<select id="tf-customer">${data.samples.map(s=>`<option value="${esc(s.customer)}" ${s.customer===sample.customer?'selected':''}>${s.cohort==='cold'?'新顾客':'老客'} ${esc(s.customer)}${!s.tasks[task]?' · 未回访':''}</option>`).join('')}</select></label><label>推荐模型<select id="tf-model">${Object.keys(report.recommendation[task]).map(name=>`<option value="${name}" ${name===model?'selected':''}>${esc(MODEL_NAMES[name])}${name===d.selected_model?'（冻结模型）':name===d.baseline?'（冻结基线）':''}</option>`).join('')}</select></label></section>`+
    `<p class="showcase-model-note">${sample.cohort==='cold'?(task==='discovery'?'此顾客没有历史，本次实际执行训练期热门回退。所选模型的老客规则：':'此顾客没有历史，复购任务不适用。所选模型的老客规则：'):''}${esc(EXPLANATIONS[model])} 模型得分不是购买概率。</p>${behaviorWorkbench(sample,task,model,d,status,row)}${publicApplicability('tafeng',task)}`+
    `<p class="small-note showcase-sampling">24 名老客按训练名单与固定哈希抽样，不按测试表现筛选，未回访者也保留。另列 3 名实际新顾客作为回退示例，属于测试后按人群抽样。单个样本不代表总体效果；无商品图片或名称的数据以真实编号展示。</p>`+
    `<section class="report-panel"><h2>完整测试人群的模型比较</h2><p class="muted">以下统计不会随所选顾客改变；高亮的是当前方法。</p>${recTable(report,task,model)}${metric([['主指标人群',num(summary.customers),'全部回访老客，含无本任务目标者'],['条件 Recall 人群',num(summary.nonempty_target_customers),'仅本任务实际目标非空者'],['候选不足 10 件',pct(summary.candidate_shortfall_share),'保留短列表，不跨任务补满']])}<p class="small-note">NDCG、Precision、命中率在全部老客上平均；Precision 分母固定为 10。条件 Recall 不等于全体顾客召回率或成交率。${task==='repurchase'?'复购准确性改善时，目录覆盖也可能下降。无历史顾客的复购不适用，不计入老客表。':'新顾客统一热门回退，结果不混入老客成绩。'}</p>${task==='discovery'?`<p class="validation-boundary">新顾客单列：${num(report.recommendation[task][model].cold.customers)} 人，NDCG ${decimal(report.recommendation[task][model].cold.ndcg)}，条件 Recall ${pct(report.recommendation[task][model].cold.recall)}；所有方法使用同一热门回退。</p>`:''}${comparison(report,task)}</section>`+source(entry);
  bindBehavior(host,sample,()=>recommendation(host,report,data,entry));
  host.querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>{state.task=b.dataset.task; recommendation(host,report,data,entry);host.querySelector(`[data-task="${state.task}"]`).focus();});
  host.querySelector('#tf-customer').onchange=e=>{state.customer=e.target.value;recommendation(host,report,data,entry);host.querySelector('#tf-customer').focus();};
  host.querySelector('#tf-model').onchange=e=>{state.models[task]=e.target.value;recommendation(host,report,data,entry);host.querySelector('#tf-model').focus();};
}
function weeklyTable(report, selected) {
  return table(['方法','WAPE ↓','MAE（件／商品周）↓','总量偏差','统计拟合回退'], Object.entries(report.weekly).map(([name,v])=>`<tr class="${name===selected?'selected-row':''}"><td>${modelLabel(name,report.decisions.weekly_sales)}</td><td>${pct(v.metrics.wape)}</td><td>${num(v.metrics.mae)}</td><td>${pct(v.metrics.bias)}</td><td>${name==='autoets'?`${v.fallbacks}／${report.forecast_rows}`:'—'}</td></tr>`),'全部周销量方法比较');
}
function bars(row, model, baseline) {
  const values=[...row.past_weeks,row.predictions[baseline],row.predictions[model],row.actual];
  const labels=['前第 4 周','前第 3 周','前第 2 周','前第 1 周','对照预测','当前预测','本周实际'];
  const max=Math.max(1,...values);
  return `<figure class="showcase-chart"><svg viewBox="0 0 660 255" role="img" aria-label="前四个完整周历史销量，与当前七天预测总量和实际总量"><line x1="30" y1="206" x2="645" y2="206" stroke="#b9cdd5"/><line x1="379" y1="18" x2="379" y2="210" stroke="#b9cdd5" stroke-dasharray="4 4"/>${values.map((v,i)=>{const h=v/max*150,x=38+i*88;return `<rect x="${x}" y="${206-h}" width="48" height="${h}" rx="3" fill="${i<4?'#9bbcc8':i===4?'#af8038':i===5?'#087f9d':'#17324d'}"/><text x="${x+24}" y="${195-h}" text-anchor="middle">${num(v)}</text><text x="${x+24}" y="232" text-anchor="middle">${labels[i]}</text>`;}).join('')}</svg><figcaption>每根柱表示完整七天总量（件）。分隔线左侧为起点之前的历史；实际值只用于评分。没有将周总量均分为逐日预测，也没有预测区间。</figcaption></figure>`;
}
function forecast(host,report,data,entry) {
  state.item ||= data.items[0]; state.origin ||= data.origins[0];state.forecastModel ||= report.decisions.weekly_sales.selected_model;state.forecastBaseline ||= report.decisions.weekly_sales.baseline;
  const baseline=state.forecastBaseline,model=state.forecastModel,row=forecastRow(data,state.item,state.origin),pred=row.predictions[model];
  saveSelection('forecast',{case:'tafeng',task:'weekly_sales',model,baseline,item:state.item,origin:state.origin});
  const error=Math.abs(pred-row.actual), overall=report.weekly[model].metrics;
  host.innerHTML=title(entry,'Ta Feng 周销量预测','选择同一商品与预测起点，比较简单基线和已训练模型；同时观察绝对误差与总量偏差。')+
    `<section class="showcase-controls three"><label>预测方法<select id="tf-forecast-model">${Object.keys(report.weekly).map(name=>`<option value="${name}" ${name===model?'selected':''}>${esc(MODEL_NAMES[name])}</option>`).join('')}</select></label><label>对照方法<select id="tf-forecast-baseline">${Object.keys(report.weekly).map(id=>`<option value="${id}" ${id===baseline?'selected':''}>${esc(MODEL_NAMES[id])}</option>`).join('')}</select></label><label>商品编号<select id="tf-item">${data.items.map(id=>`<option value="${esc(id)}" ${id===state.item?'selected':''}>${esc(id)}</option>`).join('')}</select></label><label>七天预测起点<select id="tf-origin">${data.origins.map(id=>`<option value="${id}" ${id===state.origin?'selected':''}>${id}</option>`).join('')}</select></label></section><p class="showcase-model-note">${esc(EXPLANATIONS[model])} 参数在最终测试前冻结；每个起点只使用当时已发生的历史。</p><div class="forecast-guide-entry"><span>查看这个方法如何处理销量历史。</span><a class="outline small" href="#models?case=tafeng&task=weekly_sales&model=${model}">解读当前预测模型</a></div>`+
    `<section class="chart-panel"><div class="section-heading"><h2>商品 ${esc(row.item)}</h2><span class="badge">起点 ${esc(row.origin)} · 七天总量</span></div>${bars(row,model,baseline)}${metric([['当前实际',`${num(row.actual)} 件`,'真实记录的正向销量'],['当前预测',`${num(pred)} 件`,esc(MODEL_NAMES[model])],['当前绝对误差',`${num(error)} 件`,row.actual?`本商品周相对绝对误差 ${pct(error/row.actual)}`:'实际为零，相对误差不定义']])}</section>`+
    `${forecastPairEvidence(data.series,row,model,baseline,MODEL_NAMES,{scope:'全部 50 商品 × 4 个起点',unit:'商品周',caseId:'tafeng',task:'weekly_sales'})}<section class="report-panel"><h2>全部 200 个商品周的比较</h2><p class="muted">50 件训练期预先选定的商品 × 4 个起点；不按测试成绩删选商品。下方为当前方法的完整评估，切换商品不会改变整体统计。</p>${metric([['整体 WAPE',pct(overall.wape),'全部绝对误差之和／真实销量之和'],['整体 MAE',`${num(overall.mae)} 件`,'每商品周平均绝对误差'],['总量偏差',pct(overall.bias),'负数表示低估，正数表示高估']])}${weeklyTable(report,model)}<p class="small-note">WAPE 不是“1 − 准确率”；总量偏差不等于 WAPE。销量不等于无约束需求，没有库存和促销信息时不能推断缺货损失。冻结中位数基线与上周销量均保留，用于与当前模型对照。</p>${comparison(report,'weekly_sales')}<details class="selection-details"><summary>查看当前方法的四个时间窗口</summary>${table(['预测起点','WAPE','MAE（件／商品周）','总量偏差'],report.weekly[model].windows.map(w=>`<tr><td>${w.origin}</td><td>${pct(w.wape)}</td><td>${num(w.mae)}</td><td>${pct(w.bias)}</td></tr>`),'按预测起点的表现')}</details><div class="download-actions"><a class="outline" href="./showcase/${entry.resources.weekly_predictions}" download>下载全部 200 行预测</a></div></section>`+source(entry);
  for(const [id,key] of [['tf-forecast-baseline','forecastBaseline'],['tf-forecast-model','forecastModel'],['tf-item','item'],['tf-origin','origin']]) host.querySelector(`#${id}`).onchange=e=>{state[key]=e.target.value;forecast(host,report,data,entry);host.querySelector(`#${id}`).focus();};
}
function evidence(host,report,entry) {
  host.innerHTML=title(entry,'Ta Feng 模型评估报告','同一份独立留出测试中的三项任务，各自保留冻结模型、冻结基线与最终结论。')+
    `<section class="report-panel"><h2>老客复购</h2>${comparison(report,'repurchase')}${recTable(report,'repurchase',report.decisions.repurchase.selected_model)}<p class="small-note">主指标包含全部 ${num(report.recommendation.repurchase[report.decisions.repurchase.selected_model].warm.customers)} 名回访老客；条件 Recall 只含 ${num(report.recommendation.repurchase[report.decisions.repurchase.selected_model].warm.nonempty_target_customers)} 名存在复购目标的顾客，不是整体准确率。</p></section>`+
    `<section class="report-panel"><h2>新商品发现</h2>${comparison(report,'discovery')}${recTable(report,'discovery',report.decisions.discovery.selected_model)}<p class="small-note">主指标包含全部 ${num(report.recommendation.discovery[report.decisions.discovery.selected_model].warm.customers)} 名回访老客；条件 Recall 只含 ${num(report.recommendation.discovery[report.decisions.discovery.selected_model].warm.nonempty_target_customers)} 名存在未购目标的顾客。新顾客另列。</p></section>`+
    `<section class="report-panel"><h2>七天销量</h2>${comparison(report,'weekly_sales')}${weeklyTable(report,report.decisions.weekly_sales.selected_model)}<p class="small-note">四个周起点不支持跨季节稳定性结论；200 个商品周不是 200 次独立时间实验。</p></section>`+
    `<section class="report-panel"><h2>评估范围与时间边界</h2><p class="showcase-model-note">训练／开发／测试按时间分开；模型选择在最终测试前冻结。UCI 是另一份数据上的开发验证，不能用它与 Ta Feng 的 Recall 或 WAPE 差值宣称模型提升。当前页面读取核验后的保存结果，不进行在线训练。</p><details class="selection-details"><summary>查看冻结模型的参数与输入特征</summary><pre>${esc(JSON.stringify(report.decisions,null,2))}</pre></details></section>`+source(entry);
}
export async function renderShowcase(page,host,manifest,entry,isCurrent) {
  host.innerHTML='<div class="empty-state"><h2>正在读取已核验的实验结果…</h2></div>';
  try {
    const report=await loadShowcaseResource(manifest,entry,'report');
    const data=page==='recommend'?await loadShowcaseResource(manifest,entry,'recommendations'):page==='forecast'?await loadShowcaseResource(manifest,entry,'weekly'):null;
    if(!isCurrent()) return;
    const params=new URLSearchParams(location.hash.split('?')[1]||'');
    if(page==='recommend') {
      const task=params.get('task'), model=params.get('model');
      if(['repurchase','discovery'].includes(task)) state.task=task;
      if(Object.hasOwn(report.recommendation[state.task],model)) state.models[state.task]=model;
      recommendation(host,report,data,entry);
    }
    else if(page==='forecast') { const model=params.get('model'); if(Object.hasOwn(report.weekly,model)) state.forecastModel=model; forecast(host,report,data,entry); }
    else evidence(host,report,entry);
  } catch(error) {
    if(isCurrent()) host.innerHTML=`<section class="report-panel"><h2>案例暂未就绪</h2><p>${esc(error.message)}</p><p>请重新加载页面；如仍无法读取，请检查案例结果数据包。</p></section>`;
  }
}

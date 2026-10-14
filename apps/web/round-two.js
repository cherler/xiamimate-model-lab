import {uciData, uciDownload, uciAttribution} from './uci-static.js';
import {productNameHtml, productLabel} from './product-labels.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = v => v == null ? '—' : `${(v * 100).toFixed(2)}%`;
const num = v => v == null ? '—' : Number(v).toLocaleString('zh-CN', {maximumFractionDigits:2});
const seconds = v => v > 0 && v < .01 ? '&lt;0.01' : num(v);
const names = {popular:'热门商品', itemcf:'ItemCF', basket:'最近一单搭配', als:'ALS', ease:'EASE',personal_frequency:'个人高频复购',personal_recent:'个人最近购买',personal_decay:'近期加权复购',hybrid:'ALS＋复购融合'};
const descriptions = {
  personal_frequency:'按这位顾客过去购买该商品的不同订单次数排序；同单重复行只记一次。',
  personal_recent:'按这位顾客最近购买的时间排序，同分用全体顾客历史热度补齐。',
  personal_decay:'将购买事件按距预测起点的天数衰减，越近的复购权重越大。',
  hybrid:'融合 ALS 的非负相对分数与时间衰减复购分数，权重只在开发窗口比较。',
  popular:'按训练期购买人数排序。所有顾客看到相同的热门候选。',
  itemcf:'从历史共购学习商品相似度，将顾客买过的商品作为推荐线索。',
  basket:'使用同一套 ItemCF 相似度，只参考顾客最近一单的商品。',
  als:'将顾客偏好和商品特征压缩为潜在向量，通过向量匹配给商品排序。',
  ease:'学习一个对角线为零的商品线性权重矩阵，综合历史商品的正向与负向贡献。'
};
const state = {customer:null, strategy:null, exclude:false, exploration:0, limit:10, technical:false, item:null, origin:null, forecast:null, inventory:100, lead:7};
let requests = 0;
export function cancelRoundTwo() { requests++; }

function header(title, subtitle, report, view=false) {
  return `<div class="breadcrumb">模型工坊<span>/</span>${report.schema_version>=3?'第三轮':'第二轮'} · 真实数据实验</div><div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${view?`<div class="view-switch"><button id="business-view" class="${!state.technical?'active':''}" aria-pressed="${!state.technical}">业务视角</button><button id="technical-view" class="${state.technical?'active':''}" aria-pressed="${state.technical}">技术视角</button></div>`:''}</div><div class="prototype-note real-note"><span class="status-dot"></span>公开数据 · 本地 CPU 实训 · 三窗口开发验证<span class="note-divider">/</span><span>实验 ${esc(report.run_id)}</span></div>${uciAttribution()}`;
}
const metrics = rows => `<div class="pending-metrics real-metrics">${rows.map(([label,value,detail])=>`<div><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`).join('')}</div>`;
const boundary = '<p class="small-note validation-boundary">9 / 10 / 11 月三个窗口同时用于选参与比较，属于开发验证，不是全新独立测试，也不代表线上收入或补货收益。</p>';
function recTable(r, selected) {
  return `<div class="table-scroll"><table><thead><tr><th>推荐模型</th><th>Recall@10 ↑</th><th>NDCG@10 ↑</th><th>至少命中一件 ↑</th><th>目录覆盖率 ↑</th><th>排序 P95</th></tr></thead><tbody>${Object.entries(r.recommendation.models).map(([id,m])=>`<tr class="${id===selected?'selected-row':''}"><td>${names[id]}${id===r.recommendation.default_model?'<small class="table-tag">本轮 NDCG 最优</small>':''}</td><td>${pct(m.metrics.recall)}</td><td>${m.metrics.ndcg.toFixed(4)}</td><td>${pct(m.metrics.hit_rate)}</td><td>${pct(m.metrics.catalog_coverage)}</td><td>${num(m.latency.p95_ms)} ms</td></tr>`).join('')}</tbody></table></div>`;
}
function forecastTable(r, selected) {
  return `<div class="table-scroll"><table><thead><tr><th>预测模型</th><th>WAPE ↓</th><th>MAE ↓</th><th>总量偏差</th><th>拟合耗时合计</th><th>失败回退</th></tr></thead><tbody>${Object.entries(r.forecast.models).map(([id,m])=>`<tr class="${id===selected?'selected-row':''}"><td>${esc(m.label)}${id===r.forecast.default_model?'<small class="table-tag">本轮 WAPE 最低</small>':''}</td><td>${pct(m.metrics.wape)}</td><td>${num(m.metrics.mae)} 件</td><td>${pct(m.metrics.bias)}</td><td>${seconds(m.training_seconds)} s</td><td>${m.fallback_series} / 36</td></tr>`).join('')}</tbody></table></div>`;
}
function technical(type, r) {
  if (!state.technical) return '';
  const steps = type==='recommend' ? ['正向购买记录','冻结历史与目录','二元顾客商品矩阵','ALS / EASE / ItemCF','全目录 Top 10','三窗口同口径比较'] : ['英国商品日销量','预测起点前的历史','直接预测未来 28 天','多模型与强基线比较','滚动起点重训','误差与偏差审计'];
  return `<section class="technical-panel"><h2>当前实验流程</h2><div class="pipeline">${steps.map((text,i)=>`<span><small>${i+1}</small>${text}</span>`).join('')}</div><p>${type==='recommend'?'所有模型共享每个窗口的训练目录，允许复购，不抽样负例；新顾客统一回退热门，未来新商品计为未命中。ALS 使用隐式反馈置信度，EASE 保留负向权重。':(r.schema_version>=3?'第三轮保留第二轮全部预测，新增零预测、均值与中位数，并在相同丰富历史特征上训练 L1、原始数量 L2 和 log1p 数量 L2。新增同星期历史均值、中位数、零销量比例与销量极值；没有窗口内真实销量回灌。':'LightGBM 比较平方误差、Poisson、Tweedie 三类目标；训练标签是原始销量。Ridge 保留第一轮的 log1p 标签与反变换。每个训练样本的全部 28 天标签都早于当前预测起点。')}</p><details><summary>查看选定参数</summary><pre>${esc(JSON.stringify(type==='recommend'?r.recommendation.selected_params:r.schema_version>=3?{round2:r.forecast.selected_params,round3:r.config.forecast}:r.forecast.selected_params,null,2))}</pre></details>${boundary}</section>`;
}
function bindView(main, rerender) {
  main.querySelector('#business-view').onclick=()=>{state.technical=false;rerender();};
  main.querySelector('#technical-view').onclick=()=>{state.technical=true;rerender();};
}
export async function renderRoundTwo(page, main, report, isCurrent, options={}) {
  if (page==='recommend') await recommendation(main,report,isCurrent);
  else if (page==='forecast') await forecasting(main,report,isCurrent,options);
  else evidence(main,report);
}
async function recommendation(main,r,isCurrent) {
  const customers = await uciData('customers');
  if (!isCurrent()) return;
  if (customers.run_id!==r.run_id) throw new Error('训练版本已更新，请刷新页面。');
  if (!state.customer || ![...customers.customers,'new'].includes(state.customer)) state.customer=customers.customers[0];
  state.strategy ??= r.recommendation.default_model;
  const requestedModel=new URLSearchParams(location.hash.split('?')[1]||'').get('model');
  if(Object.hasOwn(r.recommendation.models,requestedModel)) state.strategy=requestedModel;
  const render = async () => {
    if (!isCurrent()) return;
    main.innerHTML=header('UCI 商品推荐与模型对比','从真实购买记录出发，查看模型怎样排序，以及在历史验证中的表现。',r,true)+technical('recommend',r)+`<section class="workbench" aria-label="模型推荐工作台"><div class="customer-pane"><h2>选择一位顾客</h2><label class="sr-only" for="customer">选择顾客</label><select id="customer">${[...customers.customers,'new'].map(id=>`<option value="${esc(id)}" ${id===state.customer?'selected':''}>${id==='new'?'新顾客 · 热门回退':`匿名顾客 ${esc(id)}`}</option>`).join('')}</select><div class="section-heading history-heading"><h3>最近购买</h3><span class="badge">公开记录</span></div><div id="history"></div><p class="small-note">截至 ${esc(customers.as_of)} 之前。顾客从训练集随机抽样；中文为原始英文名称的参考译名，无对应译名时保留英文。不使用无来源商品图片。</p></div><div class="recommend-pane"><div class="section-heading"><h2>为这位顾客推荐</h2><span class="muted" id="result-count"></span></div><div class="strategy-tabs model-tabs" aria-label="推荐模型">${Object.entries(names).filter(([id])=>r.recommendation.models[id]).map(([id,name])=>`<button data-model="${id}" aria-pressed="${id===state.strategy}" class="${id===state.strategy?'active':''}">${name}</button>`).join('')}</div><p class="small-note" id="model-description"></p><div id="recommendations" aria-live="polite"></div></div><form class="rules-pane" id="rules-form"><h2>经营规则</h2><label class="toggle-label" for="exclude">排除已购商品<input type="checkbox" role="switch" id="exclude" ${state.exclude?'checked':''}></label><label class="range-label" for="count">推荐数量<output id="count-output">${state.limit}</output></label><input id="count" type="range" min="2" max="10" value="${state.limit}"><label class="range-label" for="explore">探索更多商品<output id="explore-output">${state.exploration}%</output></label><input id="explore" type="range" min="0" max="100" step="10" value="${state.exploration}"><div class="fallback-info"><strong>默认策略允许复购</strong><p>下方成绩只对应 Top 10、允许复购、无探索。规则变化需重新评估。</p></div><button class="primary" type="submit">更新推荐</button><p class="small-note" id="policy-note"></p></form></section><section class="report-panel"><div class="section-heading"><h2 id="selected-metric-title"></h2><a class="text-link" href="#recommend?case=uci&view=report">查看完整证据</a></div><div id="selected-metrics"></div><p class="small-note">成绩按三个窗口等权平均；当前回放使用 11 月 1 日之前训练模型的离线导出结果，覆盖原 24 位公开样本及新客示例。模型分数用于排序，不能跨模型比较大小，也不是购买概率。</p><div id="rec-comparison"></div>${boundary}</section>`;
    const refresh = async () => {
      const request = ++requests;
      const chosen = state.strategy;
      const model=r.recommendation.models[chosen];
      main.querySelector('#model-description').textContent=descriptions[chosen];
      main.querySelector('#selected-metric-title').textContent=`${names[chosen]} · 三窗口开发验证成绩`;
      main.querySelector('#selected-metrics').innerHTML=metrics([['找回的购买商品',pct(model.metrics.recall),'Recall@10 · 越高越好'],['排序质量',model.metrics.ndcg.toFixed(4),'NDCG@10 · 越高越好'],['推荐商品覆盖',pct(model.metrics.catalog_coverage),`${num(model.user_windows)} 个顾客窗口样本`]]);
      main.querySelector('#rec-comparison').innerHTML=recTable(r,chosen);
      main.querySelector('#recommendations').innerHTML='<p class="loading-copy muted">正在读取所选模型的保存结果…</p>';
      main.querySelector('#history').innerHTML='';main.querySelector('#result-count').textContent='';main.querySelector('#policy-note').textContent='';
      try {
        const output=await uciData('recommendations',{customer_id:state.customer,strategy:chosen,limit:state.limit,exclude_purchased:state.exclude,exploration:state.exploration});
        if (!isCurrent() || request!==requests) return;
        if (output.run_id!==r.run_id) throw new Error('训练版本已更新，请刷新页面。');
        main.querySelector('#history').innerHTML=output.history.length?output.history.map(p=>`<div class="history-item"><span class="stock-mark">${esc(p.id)}</span><div><strong>${productNameHtml(p.name)}</strong><small>${esc(p.date.slice(0,10))} · ${num(p.quantity)} 件</small></div></div>`).join(''):'<div class="empty-state"><h3>没有历史购买记录</h3><p>使用训练期热门推荐。</p></div>';
        main.querySelector('#result-count').textContent=`${output.items.length} 件 · 保存结果回放`;
        main.querySelector('#policy-note').textContent=output.evaluation_policy_matches?'当前设置与保存的验证策略一致。成绩是人群平均，不能作为这位顾客的购买概率。':'当前规则与报告设置不同；下方仍是默认策略成绩，不是新规则的评估结果。';
        const reason = p => p.reason.type==='personal_history'?`历史购买 ${p.reason.purchase_events} 单${p.reason.purchase_events?' · 个人复购信号':chosen==='hybrid'?' · ALS 偏好补充':' · 热门补齐'}`:p.reason.type==='latent_factors'?`${p.reason.factors} 维顾客与商品偏好匹配`:p.reason.type==='linear_contributions'?`历史商品的线性贡献 · 关联 ${p.reason.seed_id}`:p.reason.type==='learned_similarity'?`购买过 ${p.reason.seed_id} · 共购关联`:p.reason.type==='historical_popularity'?`训练期 ${num(p.reason.buyers)} 位顾客购买`:'探索加分或热度打破同分';
        const detail = p => p.reason.type==='personal_history'?`历史独立订单 ${p.reason.purchase_events} 次，最近购买距起点 ${p.reason.days_since_purchase==null?'无记录':num(p.reason.days_since_purchase)+' 天'}；90 天时间衰减权重和 ${num(p.reason.decayed_events)}。${p.reason.hybrid_als_weight==null?'':`融合中的 ALS 权重 ${pct(p.reason.hybrid_als_weight)}。`}`:p.reason.type==='latent_factors'?'顾客向量与商品向量的内积。潜在维度不直接对应某一可命名偏好。':p.reason.type==='linear_contributions'?`正向贡献之和 ${num(p.reason.positive_sum)}，负向贡献之和 ${num(p.reason.negative_sum)}；关联项 ${esc(p.reason.seed_name)} 的权重为 ${p.reason.weight.toFixed(5)}。`:p.reason.type==='learned_similarity'?`关联商品 ${esc(p.reason.seed_name)}，收缩相似度 ${p.reason.similarity.toFixed(5)}。`:'根据预测起点之前的购买人数或当前经营规则排序。';
        const maximum=Math.max(...output.items.map(p=>Math.abs(p.score)),1e-12);
        main.querySelector('#recommendations').innerHTML=(output.fallback?'<div class="fallback-banner">无可用顾客历史，所选模型已回退到热门推荐。</div>':'')+(output.items.map((p,i)=>`<article class="recommend-item"><span class="rank">${i+1}</span><span class="stock-mark">${esc(p.id)}</span><div class="product-copy"><strong>${productNameHtml(p.name)}</strong><small>${reason(p)}${p.purchased_before?' · 曾购买':''}</small><div class="score-bar" aria-label="非负排序分数的相对长度"><span style="width:${Math.max(0,p.score/maximum*100).toFixed(2)}%"></span></div><details><summary>查看 ${names[chosen]} 推荐依据</summary><p>${detail(p)} 原始排序分数 ${p.score.toFixed(5)}${p.reason.exploration?'，已含探索规则加分':''}。分数不是概率，也不是因果解释。</p></details></div></article>`).join('')||'<p class="empty-state">当前规则没有可推荐商品。</p>');
      } catch(error) {
        if(isCurrent() && request===requests) main.querySelector('#recommendations').innerHTML=`<p class="fallback-banner">${esc(error.message)}</p>`;
      }
    };
    main.querySelector('#customer').onchange=e=>{state.customer=e.target.value;refresh();};
    main.querySelectorAll('[data-model]').forEach(button=>button.onclick=()=>{state.strategy=button.dataset.model;main.querySelectorAll('[data-model]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});refresh();});
    for(const id of ['count','explore']) main.querySelector(`#${id}`).oninput=e=>main.querySelector(`#${id}-output`).textContent=e.target.value+(id==='explore'?'%':'');
    main.querySelector('#rules-form').onsubmit=e=>{e.preventDefault();state.exclude=main.querySelector('#exclude').checked;state.limit=Number(main.querySelector('#count').value);state.exploration=Number(main.querySelector('#explore').value);refresh();};
    bindView(main,render);await refresh();
  };
  await render();
}
function chart(series,model,label) {
  const history=series.history.slice(-28), prediction=series.predictions[model], baseline=series.predictions.seasonal;
  const max=Math.max(...history,...prediction,...series.actual,...baseline,1)*1.1;
  const x=i=>48+i*12.2,y=v=>246-v/max*210;
  const line=(array,offset,color,dash='')=>`<polyline points="${array.map((v,i)=>`${x(i+offset)},${y(v)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}"/>`;
  return `<svg class="real-chart" viewBox="0 0 750 285" role="img" aria-label="${esc(series.item)} ${esc(label)} 预测、真实销量和上周同期的28天对照"><rect x="383" y="24" width="342" height="222" fill="#f1f8fa"/>${[0,.5,1].map(f=>`<path d="M48 ${y(f*max)}H727" stroke="#dce7ee"/><text x="40" y="${y(f*max)+4}" text-anchor="end">${Math.round(f*max)}</text>`).join('')}<path d="M383 24V246" stroke="#9ab4bf" stroke-dasharray="4 4"/>${line(history,0,'#277ab3')}${line(series.actual,28,'#277ab3')}${line(baseline,28,'#a3b4bd','3 3')}${line(prediction,28,'#c39531','7 3')}<text x="48" y="272">${esc(series.history_dates.at(-28))}</text><text x="383" y="272">${esc(series.origin)} 预测起点</text><text x="650" y="272">${esc(series.dates.at(-1))}</text><text x="48" y="16">销量 / 件</text></svg>`;
}
async function forecasting(main,r,isCurrent,options={}) {
  const data=await uciData('forecasts');if(!isCurrent())return;
  if(data.run_id!==r.run_id)throw new Error('训练版本已更新，请刷新页面。');
  state.item ??= data.series[0].item;state.origin ??= r.forecast.windows.at(-1).origin;state.forecast ??= (r.schema_version>=3?r.forecast.default_model:'lightgbm');
  const requestedModel=new URLSearchParams(location.hash.split('?')[1]||'').get('model');
  if(Object.hasOwn(r.forecast.models,requestedModel)) state.forecast=requestedModel;
  const render=()=>{
    if(!isCurrent())return;
    const s=data.series.find(row=>row.item===state.item && row.origin===state.origin), id=state.forecast, m=r.forecast.models[id], current=s.metrics[id];
    const caution=Math.abs(m.metrics.bias)>.2;
    main.innerHTML=(options.navigation?.html||'')+header('UCI 28 天销量预测',`${Object.keys(r.forecast.models).length} 种方法 · 12 件英国零售商品 · 三个滚动 28 天窗口`,r,true)+technical('forecast',r)+`<div class="report-callout ${caution?'forecast-caution':''}"><strong>${esc(m.label)}：三窗口 WAPE ${pct(m.metrics.wape)}，总量偏差 ${pct(m.metrics.bias)}</strong><p>${caution?'存在明显的系统性'+(m.metrics.bias<0?'低估':'高估')+'，不应直接用于真实补货。':'仍需在新数据和真实经营条件下验证。'}当前展示所选模型的真实历史预测；${r.forecast.models[r.forecast.default_model].label} 在本轮 WAPE 最低。</p></div><div class="forecast-selectors model-selectors"><label>预测模型<select id="forecast-model">${Object.entries(r.forecast.models).map(([key,value])=>`<option value="${key}" ${key===id?'selected':''}>${esc(value.label)}</option>`).join('')}</select></label><label>选择商品<select id="forecast-item">${data.series.filter(row=>row.origin===state.origin).map(row=>`<option value="${esc(row.item)}" ${row.item===state.item?'selected':''}>${esc(row.item)} · ${esc(row.name)}</option>`).join('')}</select></label><label>回测起点<select id="forecast-origin">${r.forecast.windows.map(w=>`<option value="${w.origin}" ${w.origin===state.origin?'selected':''}>${w.origin} → ${w.end}</option>`).join('')}</select></label></div><div class="forecast-guide-entry"><span>查看输入特征、训练方式与局限。</span><a class="outline small" href="#models?case=uci&task=daily_sales&model=${id}">解读当前预测模型</a></div><div class="forecast-layout"><section class="chart-panel"><div class="section-heading"><div><h2>${productNameHtml(s.name)}</h2><p class="muted">货号 ${esc(s.item)} · ${esc(m.label)} · 只用 ${s.origin} 之前的数据训练</p></div><span class="badge">历史开发验证</span></div>${s.fallback_models.includes(id)?'<div class="fallback-banner">该统计模型拟合失败或超时；此曲线明确使用上周同期回退，失败详情已写入报告。</div>':''}<div class="chart-legend"><span class="blue">真实销量</span><span class="gray">上周同期</span><span class="gold">${esc(m.label)}</span></div>${chart(s,id,m.label)}${metrics([['当前商品 WAPE',pct(current.wape),'越低越好'],['当前商品 MAE',num(current.mae),'件 / 天'],['当前商品总量偏差',pct(current.bias),'正数高估 · 负数低估']])}<div class="chart-caption">验证期真实销量只用于评分与对照图。曲线为点预测，没有校准后的预测区间；销量不等于缺货情况下的真实需求。</div></section><section class="rules-pane forecast-rules"><h2>补货情景</h2><p class="small-note">跟随当前所选模型。库存和提前期为你设置的假设。</p><label class="range-label" for="lead">采购提前期<output id="lead-output">${state.lead} 天</output></label><input id="lead" type="range" min="1" max="28" value="${state.lead}"><label for="inventory">假设现有库存（件）<input id="inventory" type="number" min="0" max="10000000" value="${state.inventory}"></label><div class="scenario-result"><span>覆盖提前期的补货量</span><strong id="reorder"></strong><small id="forecast-demand"></small></div><p class="small-note">预测销量之和 − 假设库存，下限为 0，向上取整。不包含安全库存、在途量或起订量。</p></section></div><section class="report-panel forecast-summary"><h2>全部方法 · 同一 28 天逐日验证范围</h2>${forecastTable(r,id)}<p class="small-note">${r.forecast.rows_evaluated} 个商品日；WAPE 为全部绝对误差 / 全部真实销量，MAE 为每商品日误差。统计模型耗时包含进程启动；失败回退次数有单独记录。</p>${boundary}<a class="text-link" href="#forecast?case=uci&view=report">查看逐窗口成绩与完整参数</a></section>`;
    for(const [control,key] of [['forecast-model','forecast'],['forecast-item','item'],['forecast-origin','origin']])main.querySelector(`#${control}`).onchange=e=>{state[key]=e.target.value;render();};
    const update=()=>{state.lead=Number(main.querySelector('#lead').value);const raw=Number(main.querySelector('#inventory').value);state.inventory=Number.isFinite(raw)?Math.max(0,Math.min(10000000,raw)):0;main.querySelector('#lead-output').textContent=`${state.lead} 天`;const demand=s.predictions[id].slice(0,state.lead).reduce((a,b)=>a+b,0);main.querySelector('#reorder').textContent=`${num(Math.ceil(Math.max(0,demand-state.inventory)))} 件`;main.querySelector('#forecast-demand').textContent=`提前期预测销量 ${num(demand)} 件`;};
    main.querySelector('#lead').oninput=update;main.querySelector('#inventory').oninput=update;update();bindView(main,render);options.navigation?.bind(main);
  };render();
}
function evidence(main,r) {
  const rec=r.recommendation, f=r.forecast;
  main.innerHTML=header('UCI 模型评估报告','记录统一时间窗口下的模型评分、基线对照、训练成本和逐条预测。',r)+`<section class="report-panel"><div class="section-heading"><h2>01 / 推荐模型对比</h2><span class="badge">Top 10 · 允许复购</span></div>${recTable(r,rec.default_model)}${boundary}<details class="selection-details"><summary>展开三个窗口的推荐成绩与冷启动分层</summary><div class="table-scroll"><table><thead><tr><th>窗口</th><th>模型</th><th>Recall@10</th><th>NDCG@10</th><th>有历史顾客 NDCG</th><th>冷启动 NDCG</th><th>顾客数</th></tr></thead><tbody>${Object.entries(rec.models).flatMap(([id,model])=>model.windows.map(w=>`<tr><td>${w.origin}</td><td>${names[id]}</td><td>${pct(w.recall)}</td><td>${w.ndcg.toFixed(4)}</td><td>${w.cohorts.warm.ndcg?.toFixed(4)??'—'}</td><td>${w.cohorts.cold.ndcg?.toFixed(4)??'—'}</td><td>${num(w.users)}</td></tr>`)).join('')}</tbody></table></div></details><p class="small-note">按窗口等权平均，每个窗口内按顾客平均；跨月重复顾客不是独立新顾客。候选为每个窗口之前至少有两位买家的商品，未见目标商品仍计未命中。P95 为 100 次本地排序调用，不含网络和页面。</p></section><section class="report-panel"><h2>02 / 预测模型对比</h2>${forecastTable(r,f.default_model)}<details class="selection-details"><summary>展开各窗口预测误差</summary><div class="table-scroll"><table><thead><tr><th>窗口</th><th>模型</th><th>WAPE</th><th>MAE</th><th>总量偏差</th></tr></thead><tbody>${f.windows.flatMap(w=>Object.entries(w.models).map(([id,m])=>`<tr><td>${w.origin} → ${w.end}</td><td>${esc(f.models[id].label)}</td><td>${pct(m.wape)}</td><td>${num(m.mae)}</td><td>${pct(m.bias)}</td></tr>`)).join('')}</tbody></table></div></details><p class="small-note">12 件活跃高销量商品在 9 月 1 日之前选定；缺交易日期补零。没有缺货、促销或曝光信息。Ridge 使用对数标签，反变换后可能低估尖峰；LightGBM 直接拟合销量，并比较三类目标函数。没有强制某个算法胜出。</p></section><section class="report-panel"><h2>03 / 本地 CPU 成本与稳定性</h2><div class="table-scroll"><table><thead><tr><th>推荐模型</th><th>三窗口拟合耗时</th><th>模型文件大小</th><th>采样进程峰值内存</th></tr></thead><tbody>${Object.entries(rec.models).map(([id,m])=>`<tr><td>${names[id]}</td><td>${id==='popular'?'共享预处理，未单独计时':num(m.resources.reduce((sum,x)=>sum+(x.training_seconds||0),0))+' s'}</td><td>${num(m.model_bytes/1024/1024)} MB</td><td>${id==='popular'?'—':num(Math.max(...m.resources.map(x=>x.sampled_process_tree_peak_rss_mb||0)))+' MB'}</td></tr>`).join('')}</tbody></table></div><p class="small-note">内存为整个训练进程的采样 RSS，含已加载数据及其他模型，不能当作模型独占内存。第三轮中的旧模型成本来自第二轮原运行；个人复购基线共享聚合开销，融合还需要 ALS，耗时不可直接相加。ItemCF 与最近一单搭配共享一次拟合。文件大小只计模型矩阵 / 因子，不含共同的目录和顾客历史。预测流程采样峰值 ${num((r.third_round_forecast_resources||f.resources).sampled_process_tree_peak_rss_mb)} MB。当前轮训练与评估耗时 ${num(r.duration_seconds)} s。</p><p class="small-note">ALS 最后窗口的三个种子 NDCG：${rec.seed_stability.map(x=>`${x.seed} → ${x.metrics.ndcg.toFixed(4)}`).join('；')}。同种子重训因子最大差值 ${num(rec.seed_stability.find(x=>x.seed===42).factor_max_difference_from_seed42)}；LightGBM 保存再加载预测最大差值 ${num(f.reload_max_absolute_error)}。</p></section><section class="report-panel"><h2>04 / 数据与复现</h2>${metrics([['原始记录',num(r.source.raw_rows),'UCI 两张原始表'],['保留正向记录',num(r.source.clean_rows),'取消订单、重复行等已剔除'],['训练环境','本地 CPU',`${r.environment.machine} · ${r.environment.threads} 线程`]])}<details class="selection-details"><summary>模型参数、候选成绩、失败记录与环境版本</summary><pre>${esc(JSON.stringify({config:r.config,recommendation_candidates:rec.candidates,forecast_candidates:f.candidates,statistical_failures:f.fallbacks,environment:r.environment},null,2))}</pre></details><div class="download-actions"><a class="outline" href="${uciDownload(`report.json`)}" download>完整实验报告</a><a class="outline" href="${uciDownload(`forecast-predictions.csv.gz`)}" download>销量逐日预测</a><a class="outline" href="${uciDownload(`checksums.json`)}" download>产物校验清单</a></div><div class="download-actions">${Object.entries(names).filter(([id])=>r.recommendation.models[id]).map(([id,name])=>`<a class="text-link" href="${uciDownload(`validation-predictions-${id}.csv.gz`)}" download>${name} 逐顾客预测</a>`).join('')}</div><p class="small-note">原始数据 SHA-256：<code class="hash-text">${esc(r.source.input_sha256)}</code>。第一轮报告保留在独立实验目录；由于窗口口径不同，不将两轮数字直接作为提升幅度。</p></section><section class="source-panel"><h2>来源与证据边界</h2><p><a href="https://archive.ics.uci.edu/dataset/502/online+retail+ii" target="_blank" rel="noreferrer">UCI Online Retail II</a> · CC BY 4.0 · Chen, D. (2012) · <a href="https://doi.org/10.24432/C5CG6D">数据 DOI</a>。数据已进行去重、订单筛选与时间聚合。</p><p>本项目展示数据处理、训练、离线验证和服务交付能力。三个开发窗口用于选参与比较，不能作为未见数据上的独立确认；实际转化、利润和缺货改善需要真实业务试点与对照实验。</p></section>`;
}

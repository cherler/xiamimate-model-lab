import {renderRoundThree} from './round-three.js';
import {renderRoundTwo, cancelRoundTwo} from './round-two.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = value => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
const number = value => Number(value).toLocaleString('zh-CN', {maximumFractionDigits: 1});
const forecastObservation = f => f.ridge.bias < -.2 ? '模型仍明显低估销量' : f.ridge.bias > .2 ? '模型仍明显高估销量' : '历史回测仍需验证业务适用性';
const names = {popular:'热门商品',itemcf:'个性化 ItemCF',basket:'最近一单搭配'};
const state = {customer:null, strategy:'itemcf', limit:10, exclude:false, exploration:0, technical:false, item:null, origin:'2011-10-01', lead:7, inventory:100};
let generation = 0;
let activeRequests = 0;
export function cancelCase() { generation++; activeRequests++; cancelRoundTwo(); }
async function api(path, body) {
  const response = await fetch(`/api/v1/${path}`, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '读取失败');
  return data;
}
function header(title, sub, runId, toggle=false) {
  return `<div class="breadcrumb">真实数据案例<span>/</span>UCI Online Retail II</div><div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div>${toggle ? `<div class="view-switch"><button id="business-view" class="${!state.technical?'active':''}" aria-pressed="${!state.technical}">业务视角</button><button id="technical-view" class="${state.technical?'active':''}" aria-pressed="${state.technical}">技术视角</button></div>`:''}</div><div class="prototype-note real-note"><span class="status-dot"></span>公开数据 · 已训练模型 · 历史离线验证 <span class="note-divider">/</span><span>实验 ${esc(runId)}，不代表线上收益</span></div>`;
}
function metrics(items) {
  return `<div class="pending-metrics real-metrics">${items.map(([label,value,detail])=>`<div><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`).join('')}</div>`;
}
function tech(type, report) {
  if (!state.technical) return '';
  const rec = type === 'recommend';
  return `<section class="technical-panel"><div class="section-heading"><h2>当前执行的模型流程</h2><span class="badge">可复现</span></div><div class="pipeline">${(rec?['清洗正向订单','时间切分','商品共购矩阵','收缩余弦相似度','Top 10 排序','留出月评估']:['英国商品日销量','历史滞后特征','标准化 + Ridge','直接预测 28 天','滚动回测','情景补货计算']).map((x,i)=>`<span><small>${i+1}</small>${x}</span>`).join('')}</div><div class="tech-columns"><div><h3>${rec?'训练与选参':'特征与训练'}</h3><p>${rec?`以不同顾客是否购买过构造二元矩阵，按共购人数收缩余弦相似度。验证集选择 shrinkage=${report.selection.selected_params.shrinkage}，每件商品保留 64 个邻居。测试集不参与选参。`:'仅使用预测起点之前的 1/7/14/28 天销量、7/28/56 天均值、波动和目标日期。12 件商品在验证期之前选定；Ridge 正则强度仅在验证集选择。'}</p></div><div><h3>解释范围</h3><p>${rec?'推荐分数是历史相似度之和，不是购买概率。新顾客回退到训练期热门商品。更改排除已购或探索比例后，需要另外评估该策略。':'上周同期重复 4 次作为基线。两段测试窗口分别在起点前重新训练，参数固定。预测的是已记录的正向销量，库存缺货造成的未满足需求无法推断。'}</p></div></div></section>`;
}
export async function renderCase(page, main, expectedRunId) {
  const token = ++generation;
  main.innerHTML = '<div class="empty-state"><h1>正在读取真实实验…</h1><p>读取本地训练产物与评估记录。</p></div>';
  try {
    const report = await api('experiments/latest');
    if (expectedRunId && report.run_id !== expectedRunId) throw new Error('本地 UCI 版本与案例目录不同，请恢复目录指定的实验版本。');
    if(token !== generation) return;
    if(report.schema_version === 3) { await renderRoundThree(page, main, report, () => token === generation); return; }
    if(report.schema_version === 2) { await renderRoundTwo(page, main, report, () => token === generation); return; }
    if(page === 'recommend') await recommendation(main, report, token);
    else if(page === 'forecast') await forecasting(main, report, token);
    else evidence(main, report);
  } catch(error) {
    if(token !== generation) return;
    main.innerHTML = `<section class="report-panel"><h1>真实模型暂未就绪</h1><p>请先完成本地数据训练，再刷新本页。这里不会用合成结果代替真实指标。</p><p class="small-note">${esc(error.message)}</p><button class="outline" id="retry-model">重新读取</button></section>`;
    main.querySelector('#retry-model').onclick = () => renderCase(page,main);
  }
}
async function recommendation(main, report, token) {
  const customers = await api('customers');
  if(token !== generation) return;
  state.customer ??= customers.customers[0];
  const m = report.test.itemcf;
  main.innerHTML = header('让每一次推荐，都有依据。','真实购买记录 → 已训练的相似度模型 → 可以复核的推荐结果。',report.run_id,true) + tech('recommend',report) + `<section class="workbench" aria-label="真实商品推荐工作台"><div class="customer-pane"><h2>选择一位顾客</h2><label class="sr-only" for="customer">选择顾客</label><select id="customer">${[...customers.customers,'new'].map(id=>`<option value="${esc(id)}" ${state.customer===id?'selected':''}>${id==='new'?'新顾客 · 热门回退':`匿名顾客 ${esc(id)}`}</option>`).join('')}</select><div class="section-heading history-heading"><h3>最近购买</h3><span class="badge">真实公开记录</span></div><div id="history"></div><p class="small-note">截至 2011-10-01 之前。顾客从训练集随机抽样，未按测试成绩挑选。商品无原始图片，以货号展示。</p></div><div class="recommend-pane"><div class="section-heading"><h2>为这位顾客推荐</h2><span class="muted" id="result-count"></span></div><div class="strategy-tabs" aria-label="推荐策略">${Object.entries(names).map(([id,label])=>`<button data-strategy="${id}" class="${state.strategy===id?'active':''}" aria-pressed="${state.strategy===id}">${label}</button>`).join('')}</div><div id="recommendations" aria-live="polite"></div></div><form class="rules-pane" id="rules-form"><h2>经营规则</h2><label class="toggle-label" for="exclude">排除已购商品<input type="checkbox" role="switch" id="exclude" ${state.exclude?'checked':''}></label><label class="range-label" for="count">推荐数量<output id="count-output">${state.limit}</output></label><input type="range" id="count" min="2" max="10" value="${state.limit}"><label class="range-label" for="explore">探索更多商品<output id="explore-output">${state.exploration}%</output></label><input type="range" id="explore" min="0" max="100" step="10" value="${state.exploration}"><div class="fallback-info"><strong>评估默认允许重复购买</strong><p>测试任务为下一单商品，允许复购。修改规则只改变当前演示，不会重写已保存的成绩。</p></div><button class="primary" type="submit">更新推荐</button><p class="small-note" id="policy-note"></p></form></section><div class="bottom-grid"><section class="evidence-preview"><div class="section-heading"><h2>真实测试集表现</h2><span class="badge">ItemCF · Top 10</span></div><p class="muted">${number(m.users)} 位顾客 · 2011 年 10 月下一单</p>${metrics([['找回的购买商品',pct(m.recall),'Recall@10'],['排序质量',m.ndcg.toFixed(4),'NDCG@10'],['推荐商品覆盖',pct(m.catalog_coverage),'Catalog coverage']])}<a href="#evidence" class="text-link">比较热门基线与置信区间</a></section><section class="forecast-preview"><div class="section-heading"><h2>用同一份数据预测销量</h2><a class="outline small" href="#forecast">打开回测</a></div><p class="muted">12 件商品 · 2 个独立的 28 天测试窗口</p>${metrics([['同期基线误差',pct(report.forecast.baseline.wape),'WAPE · 越低越好'],['Ridge 模型误差',pct(report.forecast.ridge.wape),'WAPE · 越低越好']])}<p class="small-note">${forecastObservation(report.forecast)}；误差改善不等于已适合真实补货。</p></section></div>`;
  const refresh = async () => {
    const request = ++activeRequests;
    main.querySelector('#recommendations').innerHTML = '<p class="muted loading-copy">正在计算推荐…</p>';
    main.querySelector('#result-count').textContent = '';
    main.querySelector('#history').innerHTML = '';
    try {
      const data = await api('recommendations', {customer_id:state.customer,strategy:state.strategy,limit:state.limit,exclude_purchased:state.exclude,exploration:state.exploration});
      if (token!==generation || request!==activeRequests) return;
      if (data.run_id !== report.run_id) throw new Error('训练版本已更新，请刷新案例后继续。');
      main.querySelector('#history').innerHTML = data.history.length ? data.history.map(p=>`<div class="history-item"><span class="stock-mark">${esc(p.id)}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.date.slice(0,10))} · ${number(p.quantity)} 件</small></div></div>`).join('') : '<div class="empty-state"><h3>没有历史购买记录</h3><p>使用训练期热门商品。</p></div>';
      main.querySelector('#result-count').textContent = `${data.items.length} 件 · ${number(data.elapsed_ms)} ms`;
      main.querySelector('#policy-note').textContent = data.evaluation_policy_matches ? '当前 Top 10、允许复购、无探索，与效果报告中的策略设置一致。分数不是购买概率。' : '当前规则与报告评估设置不同，报告指标不能当作当前规则的成绩。分数不是购买概率。';
      const reason = p => p.reason.type==='learned_similarity' ? `购买过 ${p.reason.seed_id} · 学习到的共购关联` : p.reason.type==='historical_popularity' ? `训练期 ${number(p.reason.buyers)} 位顾客购买过` : '探索规则或热度打破同分';
      main.querySelector('#recommendations').innerHTML = `${data.fallback?'<div class="fallback-banner">当前无可用历史信号，已自动回退到热门推荐。</div>':''}${data.items.map((p,i)=>`<article class="recommend-item"><span class="rank">${i+1}</span><span class="stock-mark">${esc(p.id)}</span><div class="product-copy"><strong>${esc(p.name)}</strong><small>${reason(p)}${p.purchased_before?' · 曾购买':''}</small><div class="score-bar" aria-label="相对排序分数"><span style="width:${Math.max(0,p.score/Math.max(data.items[0].score,1e-10)*100).toFixed(2)}%"></span></div><details><summary>查看推荐依据</summary><p>${p.reason.seed_name?`关联商品：${esc(p.reason.seed_name)}。收缩相似度 ${p.reason.similarity.toFixed(5)}。`:''}排序分数 ${p.score.toFixed(5)}；${p.reason.exploration?'包含探索规则加分；':''}只使用预测时点之前的信息。实验 ${esc(data.run_id)}。</p></details></div></article>`).join('') || '<div class="empty-state">当前规则没有可推荐商品。</div>'}`;
    } catch(error) {
      if(token===generation && request===activeRequests) main.querySelector('#recommendations').innerHTML=`<p class="fallback-banner">${esc(error.message)}</p>`;
    }
  };
  main.querySelector('#customer').onchange=e=>{state.customer=e.target.value;refresh();};
  main.querySelectorAll('[data-strategy]').forEach(button=>button.onclick=()=>{state.strategy=button.dataset.strategy;main.querySelectorAll('[data-strategy]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});refresh();});
  for(const id of ['count','explore']) main.querySelector(`#${id}`).oninput=e=>main.querySelector(`#${id}-output`).textContent=e.target.value+(id==='explore'?'%':'');
  main.querySelector('#rules-form').onsubmit=e=>{e.preventDefault();state.exclude=main.querySelector('#exclude').checked;state.limit=Number(main.querySelector('#count').value);state.exploration=Number(main.querySelector('#explore').value);refresh();};
  bindView(main,'recommend'); await refresh();
}
function bindView(main,page) {
  main.querySelector('#business-view').onclick=()=>{state.technical=false;renderCase(page,main);};
  main.querySelector('#technical-view').onclick=()=>{state.technical=true;renderCase(page,main);};
}
function chart(s) {
  const histories = s.history.slice(-28), all = [...histories,...s.actual,...s.prediction,...s.baseline];
  const max = Math.max(...all,1)*1.1;
  const x = i => 48+i*12.2, y = value=>246-value/max*210;
  const line = (arr,offset,color,dash='')=>`<polyline points="${arr.map((v,i)=>`${x(i+offset)},${y(v)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
  return `<svg class="real-chart" viewBox="0 0 750 285" role="img" aria-label="${esc(s.item)}：预测前28天真实销量，以及测试期真实销量、同期基线和Ridge预测的对照"><rect x="383" y="24" width="342" height="222" fill="#f1f8fa"/>${[0,.5,1].map(f=>`<path d="M48 ${y(f*max)}H727" stroke="#dce7ee"/><text x="40" y="${y(f*max)+4}" text-anchor="end">${Math.round(f*max)}</text>`).join('')}<path d="M383 24V246" stroke="#9ab4bf" stroke-dasharray="4 4"/>${line(histories,0,'#277ab3')}${line(s.actual,28,'#277ab3')}${line(s.baseline,28,'#a3b4bd','3 3')}${line(s.prediction,28,'#c39531','7 3')}<text x="48" y="272">${esc(s.history_dates.at(-28))}</text><text x="383" y="272">${esc(s.origin)} 预测起点</text><text x="650" y="272">${esc(s.dates.at(-1))}</text><text x="48" y="16">销量 / 件</text></svg>`;
}
async function forecasting(main, report, token) {
  const data=await api('forecasts'); if(token!==generation)return;
  if (data.run_id !== report.run_id) throw new Error('训练版本已更新，请刷新案例后继续。');
  state.item ??= data.series[0].item;
  const render = () => {
    const s=data.series.find(x=>x.item===state.item && x.origin===state.origin);
    const f=data.summary;
    main.innerHTML=header('用过去训练，用后来验证。','英国零售商品 · 真实销量历史回测 · 28 天预测窗口',report.run_id,true)+tech('forecast',report)+`<div class="report-callout forecast-caution"><strong>实验发现：${forecastObservation(f)}。</strong><p>全部测试日的总量偏差为 ${pct(f.ridge.bias)}。目前用于回测讲解与情景演示，尚不适合真实补货决策。</p></div><div class="forecast-selectors"><label>选择商品<select id="forecast-item">${data.series.filter(x=>x.origin===state.origin).map(x=>`<option value="${esc(x.item)}" ${x.item===state.item?'selected':''}>${esc(x.item)} · ${esc(x.name)}</option>`).join('')}</select></label><label>回测起点<select id="forecast-origin">${f.windows.map(w=>`<option value="${w.origin}" ${w.origin===state.origin?'selected':''}>${w.origin} → ${w.end}</option>`).join('')}</select></label></div><div class="forecast-layout"><section class="chart-panel"><div class="section-heading"><div><h2>${esc(s.name)}</h2><p class="muted">货号 ${esc(s.item)} · 预测时只使用 ${esc(s.origin)} 之前的数据</p></div><span class="badge">真实离线回测</span></div><div class="chart-legend"><span class="blue">真实销量</span><span class="gray">上周同期基线</span><span class="gold">Ridge 预测</span></div>${chart(s)}${metrics([['当前商品基线误差',pct(s.baseline_metrics.wape),'WAPE · 越低越好'],['当前商品模型误差',pct(s.model_metrics.wape),'WAPE · 越低越好'],['模型平均绝对误差',number(s.model_metrics.mae),'件 / 天']])}<div class="chart-caption">测试期真实销量只用于评分和这张对照图，不作为该窗口的预测输入。预测的是正向销售数量；缺货、促销和退货净额未建模，没有预测区间。</div></section><section class="rules-pane forecast-rules"><h2>补货情景</h2><p class="small-note">预测来自真实模型；库存和提前期是你设置的假设。</p><label class="range-label" for="lead">采购提前期<output id="lead-output">${state.lead} 天</output></label><input id="lead" type="range" min="1" max="28" value="${state.lead}"><label for="inventory">假设现有库存（件）<input id="inventory" type="number" min="0" max="10000000" value="${state.inventory}"></label><div class="scenario-result"><span>覆盖提前期的补货量</span><strong id="reorder"></strong><small id="forecast-demand"></small></div><p class="small-note">规则：预测期内销量之和 − 假设库存，下限 0，向上取整。未包含安全库存、在途量和起订量，仅演示经营规则。</p></section></div><section class="report-panel forecast-summary"><h2>全部测试窗口的成绩</h2>${metrics([['上周同期 WAPE',pct(f.baseline.wape),'12 件商品 · 56 天'],['Ridge WAPE',pct(f.ridge.wape),'同一测试范围'],['模型系统性偏差',pct(f.ridge.bias),'正数高估 · 负数低估']])}<p class="small-note">${f.ridge.wape<f.baseline.wape?'本次 Ridge 总体误差低于同期基线。':'本次 Ridge 总体误差高于同期基线，当前应保留基线作为优先方案。'}只覆盖训练期选定的 12 件活跃高销量商品，不代表所有商品。<a class="text-link" href="#evidence">查看完整报告</a></p></section>`;
    main.querySelector('#forecast-item').onchange=e=>{state.item=e.target.value;render();};
    main.querySelector('#forecast-origin').onchange=e=>{state.origin=e.target.value;render();};
    const update=()=>{state.lead=Number(main.querySelector('#lead').value);const raw=Number(main.querySelector('#inventory').value);state.inventory=Number.isFinite(raw)?Math.max(0,Math.min(10000000,raw)):0;main.querySelector('#lead-output').textContent=`${state.lead} 天`;const demand=s.prediction.slice(0,state.lead).reduce((a,b)=>a+b,0);main.querySelector('#reorder').textContent=`${number(Math.ceil(Math.max(0,demand-state.inventory)))} 件`;main.querySelector('#forecast-demand').textContent=`提前期预测销量 ${number(demand)} 件`;};
    main.querySelector('#lead').oninput=update;main.querySelector('#inventory').oninput=update;update();bindView(main,'forecast');
  };render();
}
function evidence(main,r) {
  const f=r.forecast, ci=r.paired_difference_ci95, source=r.source;
  const removalNames={duplicate_rows:'完全重复记录',invalid_date_or_numeric:'无效日期或数值',cancelled_invoice:'取消订单',non_positive_quantity:'非正数量',non_positive_price:'非正单价',non_merchandise_code:'非商品货号'};
  const interval = key=>key==='ndcg' ? `${ci[key].difference.toFixed(4)} [${ci[key].low.toFixed(4)}, ${ci[key].high.toFixed(4)}]` : `${(ci[key].difference*100).toFixed(2)} 个百分点 [${(ci[key].low*100).toFixed(2)}, ${(ci[key].high*100).toFixed(2)}]`;
  main.innerHTML=header('结论，有一条完整的证据链。','从原始数据、时间边界，到基线、逐条预测与不确定性。',r.run_id)+`<section class="report-panel"><div class="section-heading"><h2>01 / 商品推荐：同一测试集比较</h2><span class="badge">Top 10 · 允许复购</span></div><p class="muted">训练：2011-09-01 之前；验证：9 月；最终模型重训至 10 月 1 日之前；测试：10 月每位顾客的第一单。</p><div class="table-scroll"><table><thead><tr><th>策略</th><th>Recall@10 ↑</th><th>NDCG@10 ↑</th><th>至少命中一件 ↑</th><th>目录覆盖率 ↑</th><th>测试顾客</th></tr></thead><tbody>${Object.entries(r.test).map(([key,m])=>`<tr class="${key==='itemcf'?'selected-row':''}"><td>${names[key]}</td><td>${pct(m.recall)}</td><td>${m.ndcg.toFixed(4)}</td><td>${pct(m.hit_rate)}</td><td>${pct(m.catalog_coverage)}</td><td>${number(m.users)}</td></tr>`).join('')}</tbody></table></div><div class="report-callout"><strong>ItemCF − 热门基线：配对差值与 95% 置信区间</strong><p>Recall@10：${interval('recall')}<br>NDCG@10：${interval('ndcg')}</p><small>以顾客为单位配对 bootstrap，1,000 次，种子 42。只描述该历史测试范围，不是收入增量。</small></div><div class="table-scroll"><table><thead><tr><th>ItemCF 人群</th><th>顾客数</th><th>Recall@10</th><th>NDCG@10</th></tr></thead><tbody>${Object.entries(r.test.itemcf.cohorts).map(([key,m])=>`<tr><td>${key==='warm'?'训练期有历史':'冷启动 · 热门回退'}</td><td>${number(m.users)}</td><td>${pct(m.recall)}</td><td>${m.ndcg?.toFixed(4)??'—'}</td></tr>`).join('')}</tbody></table></div><p class="small-note">Recall 为每位顾客下一单商品找回比例的平均值；NDCG 使用完整目标篮子计算理想排序。未见商品保留为未命中，目标可推荐比例 ${pct(r.test.itemcf.target_catalog_coverage)}。候选为 ${number(r.training.catalog_items)} 件训练商品，没有抽样负例。排除已购、探索比例或数量改变后需另做评估。</p></section><section class="report-panel"><div class="section-heading"><h2>02 / 销量预测：滚动历史回测</h2><span class="badge">UCI · 非 M5</span></div><p class="muted">12 件英国活跃高销量商品于验证前选定；9 月验证 Ridge alpha=${f.selected_alpha}。两段 28 天测试窗口不重叠。</p><div class="table-scroll"><table><thead><tr><th>测试范围</th><th>同期基线 WAPE ↓</th><th>Ridge WAPE ↓</th><th>Ridge MAE ↓</th><th>Ridge 偏差</th></tr></thead><tbody>${[...f.windows,{origin:'合计',end:`${f.rows_evaluated} 个商品日`,baseline:f.baseline,ridge:f.ridge}].map(w=>`<tr><td>${w.origin} / ${w.end}</td><td>${pct(w.baseline.wape)}</td><td>${pct(w.ridge.wape)}</td><td>${number(w.ridge.mae)} 件</td><td>${pct(w.ridge.bias)}</td></tr>`).join('')}</tbody></table></div><p class="small-note">本次模型总量偏差 ${pct(f.ridge.bias)}；${forecastObservation(f)}，尚未验证真实补货收益。WAPE = 绝对误差之和 / 真实销量之和；MAE = 每商品日绝对误差均值。缺交易日期按 0 填充，无法区分歇业或数据缺失。保留大额订单；销量预测不等于无约束需求。没有校准后的预测区间，也没有利润或节省金额证明。</p></section><section class="report-panel"><h2>03 / 数据审计与复现</h2>${metrics([['原始记录',number(source.raw_rows),'两张原始 Excel 表'],['保留正向商品记录',number(source.clean_rows),'缺失顾客仍可用于销量'],['推荐训练记录',number(r.training.final_rows),'仅使用时间边界前的已知顾客']])}<div class="audit-grid">${source.removed.map(x=>`<div><span>${removalNames[x.reason]||esc(x.reason)}</span><strong>− ${number(x.rows)}</strong></div>`).join('')}</div><p class="small-note">清洗剔除按顺序统计，互不重复。保留记录中 ${number(source.missing_customer_rows)} 行无顾客 ID，不参与推荐。正向记录没有重建退货后的净销量。原始数据 SHA-256：<code class="hash-text">${esc(source.input_sha256)}</code></p><details class="selection-details"><summary>查看验证集选参记录与模型配置</summary><pre>${esc(JSON.stringify({recommendation:r.selection,forecast:f.selection,environment:r.environment},null,2))}</pre></details><div class="download-actions"><a class="outline" href="/api/v1/report.json" download>下载完整报告 JSON</a><a class="outline" href="/api/v1/test-predictions-itemcf.csv.gz" download>推荐逐顾客预测</a><a class="outline" href="/api/v1/forecast-predictions.csv.gz" download>销量逐日预测</a><a class="text-link" href="/api/v1/checksums.json" download>产物校验清单</a></div></section><section class="source-panel"><h2>来源与证据边界</h2><p><a href="${esc(source.source_page)}" target="_blank" rel="noreferrer">UCI Online Retail II</a> · CC BY 4.0 · Chen, D. (2012). <a href="https://doi.org/10.24432/C5CG6D" target="_blank" rel="noreferrer">数据引用与 DOI</a>。本项目对原数据做了去重、订单筛选、时间切分与商品日聚合。</p><p>本次下载来源：<a href="${esc(source.source_url)}" target="_blank" rel="noreferrer">${source.mirror_used?'经校验的公开镜像':'UCI 原站'}</a>。${source.mirror_used?'完整 XLSX 的 SHA-256 与独立公开校验值一致，文件大小与 CRC32 与 UCI 原始压缩包成员头一致。':'原站文件已保留哈希与清洗记录。'}</p><p>这是一套公开数据上的可运行案例，展示数据处理、训练、服务与离线评估能力。线上转化、利润、缺货改善仍需真实业务接入和对照实验；不能据此声称已经为客户创造收益。</p></section>`;
}

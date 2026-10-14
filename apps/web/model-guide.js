import {FORECAST_GUIDE} from './forecast-guide.js';
import {loadManifest, loadShowcaseResource, MODEL_NAMES} from './showcase.js';
import {saveSelection} from './navigation-state.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = v => `${(v*100).toFixed(2)}%`;
const variant = (model,label) => ({model,label:label || MODEL_NAMES[model]});
export const GUIDE = [
 {id:'repeat',group:'repurchase',title:'个人复购规则',kind:'行为基线',caseId:'tafeng',task:'repurchase',variants:['personal_frequency','personal_recent','personal_decay_90d'].map(x=>variant(x)),input:'顾客、商品、历史购买日期；同商品同日去重。',process:'分别按购买日次数、最近购买时间，或 90 天指数衰减后的次数排序。',output:'已购商品的 Top 10 排序',use:'检验个人购买习惯本身能提供多强的复购信号。',limit:'不能发现从未买过的商品；没有历史的新顾客不适用。频次和近期规则本身不是协同过滤。',features:'购买日频次、距上次购买天数、时间衰减；不使用名称、图片或价格。',example:'同一件商品在两个不同日期出现，记为两个购买日；近期购买在衰减规则中权重更高。'},
 {id:'hybrid',group:'repurchase',title:'ALS＋衰减复购',kind:'信号融合',caseId:'tafeng',task:'repurchase',variants:[variant('als_decay_25')],input:'全体顾客的历史购买关系 ＋ 当前顾客的购买日期。',process:'ALS 与衰减复购分数分别截为非负、按最大值归一化，以 25%／75% 加权。',output:'只在该顾客已购商品中排序',use:'在个人复购基线上，检验共同购买关系能否提供额外信号。',limit:'融合权重不是购买概率。潜在向量没有直接读取商品属性；当前通过筛选不代表线上收益。',features:'二元用户—商品交互、90 天衰减购买日频次。',example:'可在真实样本里比较同一商品的基线名次与融合名次；命中数相同也可能有不同的排序质量。'},
 {id:'popular',group:'discovery',title:'热门推荐',kind:'非个性化基线',caseId:'tafeng',task:'discovery',variants:[variant('popular_excluding_history')],input:'训练期各商品的不同购买者人数。',process:'按购买人数排序，为老客排除买过的商品；新顾客使用热门回退。',output:'未购商品的 Top 10 排序',use:'建立简单、可解释的商品发现基线。',limit:'不学习个人偏好，容易集中推荐热门商品。',features:'商品历史购买人数、当前顾客的已购集合。',example:'两位老客排除的已购商品不同，因此热门候选相同，最终列表也可能不同。'},
 {id:'itemcf',group:'discovery',title:'ItemCF',kind:'协同过滤',caseId:'tafeng',task:'discovery',variants:[variant('itemcf_excluding_history')],input:'顾客与商品的二元购买矩阵。',process:'按共同购买者计算商品相似度，加入支持度收缩；汇总顾客历史商品的相似邻居分数。',output:'排除已购后的 Top 10 排序',use:'利用群体共购关系探索未购商品。',limit:'共购相似不等于用途或材质相似；冷启动商品缺少交互支持。',features:'二元购买关系、共现次数、余弦相似度；每件商品保留 64 个邻居。',example:'推荐依据是“买过这些商品的人也购买了什么”，不是对商品名称的语义匹配。'},
 {id:'als',group:'discovery',title:'ALS',kind:'矩阵分解',caseId:'tafeng',task:'discovery',variants:[variant('als_excluding_history')],input:'顾客与商品的历史购买矩阵，以及隐式反馈置信权重。',process:'交替学习用户与商品的 32 维潜在向量，用向量内积计算排序分数。',output:'排除已购后的 Top 10 排序',use:'从稀疏购买关系中学习潜在偏好。',limit:'潜在维度不能直接命名为颜色、品牌或价格；没有交互的新用户使用热门回退。',features:'历史二元购买关系；商品编号用于定位向量，不代表理解商品含义。',example:'即使没有直接共购，也可能通过潜在向量得到较高匹配分数；这种匹配需要用未来购买验证。'},
 {id:'category',group:'discovery',title:'类别偏好＋ALS',kind:'属性信号融合',caseId:'tafeng',task:'discovery',variants:[variant('als_category_25')],input:'起点之前的商品类别、顾客购买日事件、商品购买人数与 ALS 分数。',process:'类别信号 = 顾客该类别事件数 × 商品购买人数平方根；归一化后按类别 25%／ALS 75% 融合。',output:'排除已购后的 Top 10 排序',use:'检验有限的商品类别信息是否改善发现任务。',limit:'类别已进入这一方法，但不等于完整的属性建模。最终测试表现低于冻结 ItemCF 基线，未通过筛选。',features:'历史类别编码、用户类别偏好、商品热度、ALS 潜在分数。',example:'这是现有模型使用商品属性的实际例子；类别只有编码，不编造“食品”“饮料”等未经核实的名称。'},
 {id:'ease',group:'uci',title:'EASE',kind:'线性协同模型',caseId:'uci',task:'next_basket',variants:[variant('ease','EASE')],input:'UCI 的用户—商品历史购买矩阵。',process:'学习带正则的商品线性权重矩阵，约束对角线为零，汇总历史商品的正负贡献。',output:'下一单商品的 Top 10 排序',use:'比较线性协同模型、ALS 与简单复购方法。',limit:'当前只在 UCI 展示；没有商品文本输入。矩阵内存随商品数量平方增长。',features:'购买交互和商品间线性权重；不使用页面上的中文译名。',example:'对角线为零避免直接复制商品自身，但整体任务仍允许推荐已购商品。'},
 {id:'baselines',group:'forecast',title:'简单时间序列基线',kind:'销量参照',caseId:'tafeng',task:'weekly_sales',variants:['last_week','four_week_mean','four_week_median','zero'].map(x=>variant(x)),input:'当前预测起点之前的日销量，汇总为完整周。',process:'分别沿用上周、取前四周均值或中位数；全零预测作为误差参照。',output:'未来完整七天销量（件）',use:'检验复杂模型是否真正胜过简单历史规律。',limit:'不能感知未提供的促销、缺货或价格变化；全零只是参照，不是经营建议。',features:'过去完整周销量；全零方法不读取销量特征。',example:'同一商品、同一起点，比较预测总量和真实总量；不把周预测均分成每天。'},
 {id:'ets',group:'forecast',title:'AutoETS',kind:'统计时间序列',caseId:'tafeng',task:'weekly_sales',variants:[variant('autoets')],input:'每件商品在当前起点前的日销量序列。',process:'自动选择指数平滑结构并拟合时间序列，预测未来七天后求和。',output:'未来完整七天销量（件）',use:'让树模型与统计时间序列方法接受同范围比较。',limit:'突发变化和稀疏销量可能难以拟合；失败时回退上周销量并保留原因。',features:'历史销量的水平、趋势等时间结构；不读取名称与类别。',example:'所有方法均按相同的 200 个商品周评分；拟合失败不能删除难样本。'},
 {id:'lgbm',group:'forecast',title:'LightGBM',kind:'特征驱动的树模型',caseId:'tafeng',task:'weekly_sales',variants:[variant('lgbm_regression_l1_7')],input:'历史周销量、日销量统计、日历和固定商品编码。',process:'所有商品共用梯度提升树，以 L1 目标直接学习七天总销量；冻结版本每棵树最多 7 叶子。',output:'未来完整七天销量（件）',use:'学习历史趋势、波动和商品差异之间的非线性关系。',limit:'最终测试明显低估总销量，未通过偏差门槛；不能据此声称已适合自动补货。',features:'过去四周销量、均值／中位数、波动、最大值、零销量比例、趋势、日历与商品独热编码。',example:'商品编码帮助区分历史模式，但不等于使用品牌、用途或价格等商品属性。'},
 {id:'ridge',group:'forecast',title:'Ridge',kind:'线性预测',caseId:'uci',task:'daily_sales',variants:[variant('ridge','Ridge')],input:'历史销量、滞后统计与日历等构造特征。',process:'在对数销量上拟合带 L2 正则的线性模型，再转换回销量。',output:'未来 28 天逐日销量（件／天）',use:'作为特征驱动预测的线性参照。',limit:'对数反变换可能低估尖峰；逐日任务不能与七天总量任务直接比较 WAPE。',features:'历史滞后销量、统计、日历及商品编码，不使用商品文本。',example:'预测曲线平稳并不代表总量准确，还要同时检查 WAPE 和总量偏差。'},
 {id:'arima',group:'forecast',title:'AutoARIMA',kind:'统计时间序列',caseId:'uci',task:'daily_sales',variants:[variant('autoarima','AutoARIMA')],input:'UCI 每件商品在预测起点之前的日销量序列。',process:'自动选择 ARIMA 参数，利用序列的历史依赖进行预测。',output:'未来 28 天逐日销量（件／天）',use:'在原逐日任务中提供另一种统计模型对照。',limit:'稀疏销量可能导致拟合失败；页面与报告明确记录上周同期回退。',features:'销量序列的自回归、差分和移动平均结构，不使用商品属性。',example:'报告中的成绩包含实际回退结果，不能当作所有样本都由 ARIMA 成功预测。'},
 ...FORECAST_GUIDE,
];
export const FEATURES = [
 ['购买次数与日期','已使用','个人复购规则、融合模型','同商品同日去重；UCI 的频次以不同订单计数。'],
 ['用户—商品购买关系','已使用','ALS、ItemCF、EASE','学习共同购买关系，没有使用点击或曝光记录。'],
 ['商品类别与类别偏好','部分使用','Ta Feng 类别＋ALS','类别取起点前已知值；没有完整的品牌、材质或用途特征。'],
 ['历史购买间隔','开发候选','Ta Feng 间隔融合实验','曾在开发中比较；未进入当前冻结复购模型。'],
 ['原始英文名称／中文译名','进阶排序使用英文','UCI 进阶实验','历史英文关键词与 TF-IDF 匹配进入排序；中文译名仍仅供展示，Ta Feng 不虚构名称。'],
 ['商品价格与用户价格偏好','进阶模型已使用','UCI 排序／深度预测','排序使用历史单价、波动与用户价格距离；TFT 使用训练期单价中位数，均不使用未来成交价。'],
 ['销量滞后、波动、零销量、日历','已使用','LightGBM 等预测方法','从每个预测起点之前的历史构造；完整训练标签也必须早于起点。'],
 ['商品编号独热编码','已使用','部分销量预测模型','用于识别不同商品，不能替代商品语义属性。'],
 ['库存、促销、图片、点击、曝光','未使用','当前案例无此类输入','页面点击仅用于查看保存结果，不会成为训练数据。'],
];
export function guideLink(card, model, view) {
 const page=['weekly_sales','daily_sales'].includes(card.task)?'forecast':'recommend';
 const q=new URLSearchParams({case:card.caseId,task:card.task,model});if(view)q.set('view',view);
 return `#${page}?${q}`;
}
export function guideMetrics(card, model, report) {
 const metrics=card.caseId==='tafeng'?(card.task==='weekly_sales'?report.weekly[model]?.metrics:report.recommendation[card.task]?.[model]?.warm):(card.task==='next_basket'?report.recommendation.models[model]?.metrics:card.task==='weekly_sales'?report.weekly.models[model]?.metrics:report.forecast.models[model]?.metrics);
 const keys=['weekly_sales','daily_sales'].includes(card.task)?['wape','mae','bias']:['ndcg','recall','catalog_coverage'];
 if(!metrics || keys.some(k=>!Number.isFinite(metrics[k]))) throw new Error('该模型的指标缺失，请查看原评估报告。');
 return metrics;
}
function comparison(card,model,r) {
 if(card.caseId==='uci'&&card.task==='weekly_sales'&&model==='lightgbm') {
  const g=r.weekly.gate;
  return `<div class="showcase-verdict ${g.passed?'':'failed'}"><strong>${g.passed?'通过':'未通过'}本次开发筛选</strong><p>相对最强基线 ${esc(r.weekly.models[g.best_baseline].label)}，WAPE 改善 ${pct(g.wape_gain)}；${g.winning_windows}／12 个窗口胜出。要求改善至少 10%、绝对偏差不超过 20%、至少 8 个窗口胜出。此结果来自开发验证。</p></div>`;
 }
 if(card.caseId!=='tafeng') return '<p>这是历史开发结果，模型选择已参考这些窗口；不作为独立测试证据。</p>';
 const d=r.decisions[card.task],c=r.comparisons[card.task];
 if(model!==d.selected_model) return `<p>当前查看对照方法。冻结入选模型为 ${esc(MODEL_NAMES[d.selected_model])}；完整报告保留全部方法，不按测试成绩删选。</p>`;
 const passed=c.gain_screen_passed;
 const detail=card.task==='weekly_sales'?`相对冻结基线 ${esc(MODEL_NAMES[d.baseline])}，WAPE 降低 ${pct(c.relative_wape_gain)}，但绝对总量偏差 ${pct(c.absolute_bias)} 超过 20% 门槛；上周销量的 WAPE ${pct(r.weekly.last_week.metrics.wape)} 仍更低。`:`相对 ${esc(MODEL_NAMES[d.baseline])}，NDCG 差值 ${c.paired_ndcg.difference.toFixed(5)}；95% 顾客配对区间 [${c.paired_ndcg.low.toFixed(5)}, ${c.paired_ndcg.high.toFixed(5)}]。门槛为差值至少 0.01，且区间下界大于 0。区间仅反映本测试月。`;
 return `<div class="showcase-verdict ${passed?'':'failed'}"><strong>${passed?'通过':'未通过'}本次预设增益筛选</strong><p>${detail}</p></div>`;
}
const groups={repurchase:'老客复购',discovery:'新商品发现',uci:'UCI 推荐',forecast:'销量预测'};
const forecastScopes={'tafeng:weekly_sales':'Ta Feng · 七天总销量','uci:daily_sales':'UCI · 28 天逐日销量','uci:weekly_sales':'UCI · 七天总销量'};
export function resolveGuideSelection(params) {
 const requested=params.get('model'),caseId=params.get('case'),task=params.get('task');
 const allowed=GUIDE.filter(c=>(!caseId||c.caseId===caseId)&&(!task||c.task===task));
 const selected=allowed.find(c=>c.id===requested||c.variants.some(v=>v.model===requested)) ||
  (task==='daily_sales'?allowed.find(c=>c.id==='uci-daily-lgbm'):task==='weekly_sales'?allowed.find(c=>c.id===(caseId==='uci'?'uci-weekly-lgbm':'lgbm')):null) || allowed.find(c=>c.id==='hybrid') || allowed[0] || GUIDE.find(c=>c.id==='hybrid');
 const model=selected.variants.find(v=>v.model===requested)?.model || (selected.id==='uci-daily-lgbm'?'lgbm_history_l1':selected.variants[0].model);
 return {selected,model};
}
export function guideScope(card,m,r) {
 if(card.caseId==='uci') {
  if(card.task==='weekly_sales')return `UCI 历史开发验证 · ${r.weekly.items.length} 件商品 × ${r.weekly.origins.length} 个起点 = ${r.weekly.rows_evaluated} 个商品周。MAE 按商品周计；不是独立测试，不能与逐日任务直接比较 WAPE。`;
  return `UCI 历史开发验证 · 三个窗口；非独立测试。${card.task==='daily_sales'?'28 天逐日销量任务；MAE 按商品日计。':'下一单全篮子任务；各窗口指标等权平均。'}不能与 Ta Feng 的指标直接比较。`;
 }
 return card.task==='weekly_sales'?'Ta Feng · 2001 年 2 月留出测试 · 50 件商品 × 4 个起点 = 200 个商品周。WAPE 不是“1 − 准确率”，负偏差表示低估。':`Ta Feng · 2001 年 2 月留出测试 · NDCG 包含全部 ${m.customers.toLocaleString('zh-CN')} 名回访老客；条件 Recall 仅对 ${m.nonempty_target_customers.toLocaleString('zh-CN')} 名目标非空老客计算。冷启动另列报告。`;
}
function advancedRoadmap() {
 return `<section class="guide-next"><h2>进阶实验：特征排序、图推荐与深度预测</h2><p><a class="text-link" href="#automl">查看 AutoML 自动调参过程与前后对照 →</a></p><p>三个方向已完成本地 CPU 训练。新实验单独展示相同候选或预测范围内的对照，属于 UCI 测试后开发，非独立确认测试。</p><div class="guide-roadmap"><article><h3>LightGBM 推荐排序</h3><span class="guide-status">已训练 · 特征消融</span><p>同一候选集与树设置下，依次加入行为、商品历史价格与名称、用户—商品匹配特征。展示真实输入、三个版本成绩与样本命中。</p><a class="text-link" href="#advanced">查看属性排序与解读 →</a></article><article><h3>LightGCN 图推荐</h3><span class="guide-status">已训练 · 三个种子</span><p>两层用户—商品图传播与 BPR 学习；与 EASE、属性排序共用候选池。标准版本使用交互关系；本轮没有超过完整特征排序。</p><a class="text-link" href="#advanced">比较 LightGCN 与 EASE →</a></article><article><h3>TFT 深度销量预测</h3><span class="guide-status">已训练 · 七天逐日预测</span><p>56 天历史加静态商品、历史价格和已知日历，预测未来七天的 P10／P50／P90。与同范围树模型、时间基线一起报告点误差和实际区间覆盖。</p><a class="text-link" href="#advanced?task=forecast">查看 TFT 预测与解读 →</a></article></div><p>保留效果不佳的模型，不以模型复杂度替代量化评估；下一阶段需要新的未见时段或数据集来确认泛化能力。</p></section>`;
}
function featureMap() {
 return `<section class="guide-features"><h2>各类特征的使用情况</h2><p>原始字段、衍生特征与页面文案各有用途。推荐排序是输出，不是本项目的原始输入特征。</p><div class="table-scroll" tabindex="0" role="region" aria-label="特征使用情况"><table><thead><tr><th scope="col">信息／特征</th><th scope="col">当前状态</th><th scope="col">应用范围</th><th scope="col">说明</th></tr></thead><tbody>${FEATURES.map(row=>`<tr>${row.map((v,i)=>`<td>${i===1?`<span class="guide-status">${esc(v)}</span>`:esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section><section class="guide-next"><h2>已完成的特征对照实验</h2><p>进阶实验已整理历史可用的商品属性，比较行为特征、商品属性与用户—商品匹配特征。固定候选集、时间边界与模型设置，逐组加入特征；同时报告排序质量、覆盖率与逐窗口人群数量。</p><p>Ta Feng 最终测试已经使用。后续基于其反馈的改进须标注为测试后开发，或使用新的未见数据验证；原测试不能重新称为独立验证。特征重要性也不代表因果关系。</p></section>`;
}
export async function renderModelGuide(host,isCurrent,params=new URLSearchParams()) {
 host.innerHTML='<p class="loading-copy">正在读取模型说明与已核验成绩…</p>';
 try {
  const manifest=await loadManifest();
  const reports=Object.fromEntries(await Promise.all(manifest.cases.map(async entry=>[entry.id,await loadShowcaseResource(manifest,entry,'report')])));
  if(!isCurrent())return;
  if(params.has('model')&&!GUIDE.some(c=>c.caseId===params.get('case')&&c.task===params.get('task')&&(c.id===params.get('model')||c.variants.some(v=>v.model===params.get('model'))))){
   const card={caseId:params.get('case'),task:params.get('task')};
   host.innerHTML=`<section class="report-panel"><h1>当前方法的独立解读尚未整理</h1><p>当前选择：${esc(params.get('model'))}。此处保留你的选择；已有模型效果与样本仍可在案例中查看。</p><div class="download-actions"><a class="primary" href="${esc(guideLink(card,params.get('model')))}">返回当前模型体验</a><a class="outline" href="${esc(guideLink(card,params.get('model'),'report'))}">查看本案例完整评估</a></div></section>`;return;
  }
  let {selected,model}=resolveGuideSelection(params);
  let group=selected.group,forecastScope=group==='forecast'?`${selected.caseId}:${selected.task}`:'uci:weekly_sales';
  host.innerHTML=`<div class="breadcrumb">模型工坊<span>/</span>模型解读</div><div class="page-heading"><div><h1>${group==='forecast'?'销量预测':'商品推荐'}：模型与量化证据</h1><p>查看当前任务的输入特征、建模方法、同范围对照和适用条件。</p></div></div><section class="guide-detail-section"><div class="guide-intro"><strong>推荐和预测分任务比较</strong><p>复购关注已买商品，发现关注未买商品；销量预测估计未来数量。三项任务分别评估，分数不能跨任务比较。</p></div><nav class="guide-groups" aria-label="按业务任务浏览模型">${Object.entries(groups).filter(([id])=>group==='forecast'?id==='forecast':id!=='forecast').map(([id,label])=>`<button type="button" data-guide-group="${id}">${label}</button>`).join('')}</nav><label class="guide-scope" id="guide-scope-label">预测案例与任务<select id="guide-forecast-scope">${Object.entries(forecastScopes).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><div class="guide-layout"><nav class="guide-models" aria-label="模型目录"></nav><article id="guide-detail" aria-label="当前模型说明"></article></div></section>${featureMap()}${advancedRoadmap()}`;
  const draw=()=>{
   saveSelection(selected.group==='forecast'?'forecast':'recommend',{case:selected.caseId,task:selected.task,model});
   host.querySelector('#guide-scope-label').hidden=group!=='forecast';
   host.querySelector('#guide-forecast-scope').value=forecastScope;
   const detail={...selected,...selected.variants.find(v=>v.model===model)};
   host.querySelectorAll('[data-guide-group]').forEach(b=>{const active=b.dataset.guideGroup===group;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
   host.querySelector('.guide-models').innerHTML=GUIDE.filter(c=>c.group===group&&(group!=='forecast'||`${c.caseId}:${c.task}`===forecastScope)).map(c=>`<button type="button" data-guide-model="${c.id}" aria-pressed="${c.id===selected.id}" class="${c.id===selected.id?'active':''}"><strong>${esc(c.title)}</strong><small>${esc(c.kind)}</small></button>`).join('');
   const r=reports[selected.caseId],m=guideMetrics(selected,model,r),forecast=['weekly_sales','daily_sales'].includes(selected.task);
   const metrics=forecast?[['WAPE ↓',pct(m.wape)],['MAE ↓',`${m.mae.toFixed(2)} 件／${selected.task==='daily_sales'?'商品日':'商品周'}`],['总量偏差',pct(m.bias)]]:[['NDCG@10 ↑',m.ndcg.toFixed(5)],[selected.caseId==='tafeng'? '条件 Recall@10 ↑':'Recall@10 ↑',pct(m.recall)],['商品覆盖率',pct(m.catalog_coverage)]];
   const scope=guideScope(selected,m,r);
   host.querySelector('#guide-detail').innerHTML=`<div class="guide-card-heading"><div><span class="guide-kicker">${selected.caseId==='tafeng'?'Ta Feng · 已运行':'UCI · 已运行'}</span><h2>${esc(selected.title)}</h2></div><span class="badge">${esc(selected.kind)}</span></div><label class="guide-variant">查看具体方法<select id="guide-variant">${selected.variants.map(v=>`<option value="${v.model}" ${model===v.model?'selected':''}>${esc(v.label)}</option>`).join('')}</select></label><ol class="guide-flow">${[['输入',detail.input],['处理',detail.process],['输出',detail.output]].map(([label,text])=>`<li><strong>${label}</strong><p>${esc(text)}</p></li>`).join('')}</ol><dl class="guide-facts"><div><dt>适合解决</dt><dd>${esc(detail.use)}</dd></div><div><dt>输入特征</dt><dd>${esc(detail.features)}</dd></div><div><dt>如何理解</dt><dd>${esc(detail.example)}</dd></div><div><dt>能力边界</dt><dd>${esc(detail.limit)}</dd></div></dl><section class="guide-proof"><h3>已运行的量化证据</h3><p>${esc(scope)}</p><div class="showcase-metrics">${metrics.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><p>${forecast?'预测的是记录销量；没有库存信息时不能推断真实需求或缺货损失。':'模型分数只用于排序，不是购买概率。单个命中样本不能替代整体统计。'}</p>${comparison(selected,model,r)}<div class="download-actions"><a class="primary" href="${guideLink(selected,model)}">查看此模型的真实样本</a><a class="outline" href="${guideLink(selected,model,'report')}">查看完整评估</a></div>${selected.caseId==='uci'?'<small>UCI 样本、预测与完整评估均读取核验后的静态产物，不依赖模型服务。</small>':''}<details><summary>查看报告版本与来源</summary><p class="hash-text">${esc(r.run_id)}</p><a class="text-link" href="./showcase/${manifest.cases.find(e=>e.id===selected.caseId).resources.report}" download>下载原评估报告</a><p>页面读取与案例相同的文件，并校验内容哈希与实验版本。本次解读页没有新增训练。</p></details></section>`;
   host.querySelectorAll('[data-guide-model]').forEach(b=>b.onclick=()=>{selected=GUIDE.find(c=>c.id===b.dataset.guideModel);model=selected.variants[0].model;draw();host.querySelector(`[data-guide-model="${selected.id}"]`).focus();});
   host.querySelector('#guide-variant').onchange=e=>{model=e.target.value;draw();host.querySelector('#guide-variant').focus();};
  };
  host.querySelectorAll('[data-guide-group]').forEach(b=>b.onclick=()=>{group=b.dataset.guideGroup;selected=GUIDE.find(c=>c.group===group&&(group!=='forecast'||`${c.caseId}:${c.task}`===forecastScope));model=selected.variants[0].model;draw();});
  host.querySelector('#guide-forecast-scope').onchange=e=>{forecastScope=e.target.value;selected=GUIDE.find(c=>`${c.caseId}:${c.task}`===forecastScope&&c.group==='forecast');model=selected.variants[0].model;draw();};
  draw();
 } catch(error) {
  if(isCurrent())host.innerHTML=`<div class="breadcrumb">模型工坊<span>/</span>模型解读</div><section class="report-panel"><h1>推荐与预测模型详情暂未就绪</h1><p>${esc(error.message)}</p><p>请重新加载；未读取到报告时不显示替代成绩。</p><button class="outline" id="guide-retry" type="button">重新加载</button></section>`;
  if(isCurrent())host.querySelector('#guide-retry').onclick=()=>renderModelGuide(host,isCurrent,params);
 }
}

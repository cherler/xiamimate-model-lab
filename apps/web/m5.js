import { renderM5Details } from './m5-details.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = v => v == null ? '不适用' : `${(v * 100).toFixed(2)}%`;
const number = v => Number(v).toLocaleString('zh-CN', {maximumFractionDigits: 2});
export const M5_NAMES = {lgbm_tweedie_core:'LightGBM · Tweedie', weekday_mean_8w:'八周同星期均值', weekday_median_8w:'八周同星期中位数', seasonal_naive:'上周同日'};
const CATEGORY = {store:'门店全部商品', FOODS:'食品', HOUSEHOLD:'家居日用', HOBBIES:'兴趣用品'};
const descriptions = {
 lgbm_tweedie_core:['历史销量＋商品层级＋价格＋日历', '1,000 棵梯度提升树学习非线性关系，使用 Tweedie 损失处理非负、含零销量。一次预测未来 28 天，不把未来实际销量传回模型。', '侧重条件均值和层级误差，不保证绝对误差最小。'],
 weekday_mean_8w:['过去八周的相同星期', '分别求每个星期的历史平均销量，重复用于未来四周。它是开发期表现最好的规则基线。', '简单、稳定，但不会响应未来节日或价格变化。'],
 weekday_median_8w:['过去八周的相同星期', '取同一星期的历史销量中位数，减少偶发大单的影响。', '绝对误差可能较小，但在稀疏销量中容易系统性低估总需求。'],
 seasonal_naive:['最近完整一周的销量', '把上周各天的销量重复四次，作为最低复杂度对照。', '最近一周的偶然波动也会被重复到未来。']
};
export function seriesMetrics(actual, prediction) {
 if (actual.length !== prediction.length || !actual.length || [...actual,...prediction].some(v => !Number.isFinite(v) || v < 0)) throw new Error('无效的预测序列');
 const total = actual.reduce((a,b)=>a+b,0), predicted = prediction.reduce((a,b)=>a+b,0);
 const error = actual.reduce((a,v,i)=>a+Math.abs(v-prediction[i]),0);
 return {wape:total ? error/total : null, bias:total ? (predicted-total)/total : null, mae:error/actual.length, total, predicted};
}
export function frozenBaseline(overview) {
 return Object.entries(overview.selection.scores).filter(([id])=>id!=='lgbm_tweedie_core').sort((a,b)=>a[1]-b[1])[0][0];
}
function table(headers, rows, label) {
 return `<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(label)}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
export function m5Chart(sample, model, baseline, window, day=0, compact=false) {
 const {history,actual,predictions}=sample, predicted=predictions[model], base=predictions[baseline];
 const maximum=Math.max(1,...(compact?[]:history),...actual,...predicted,...base)*1.12;
 const width=compact?360:880, bottom=compact?200:264, right=compact?350:850;
 const x=i=>compact?48+i*11:62+i*14.1, y=v=>bottom-v/maximum*(compact?148:225);
 const offset=compact?0:28;
 const line=(values,start)=>values.map((v,i)=>`${x(start+i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
 const path=values=>compact?line(values,0):line([history[27],...values],27);
 const ticks=compact?[0,9,18,27]:[0,14,27,41,55];
 return `<svg viewBox="0 0 ${width} ${compact?240:310}" role="img" aria-label="${compact?'未来28天实际销量与两种模型的保存预测':'前28天历史、未来28天实际销量与两种模型的保存预测'}；单位件每天"><rect x="${compact?48:443}" y="25" width="${compact?302:409}" height="${bottom-25}" fill="#eef7fa"/>${[0,.25,.5,.75,1].map(f=>`<line x1="${compact?48:62}" y1="${y(maximum*f)}" x2="${right}" y2="${y(maximum*f)}" stroke="#dce7ee"/><text x="${compact?42:52}" y="${y(maximum*f)+4}" text-anchor="end">${compact?Math.round(maximum*f).toLocaleString('zh-CN'):number(maximum*f)}</text>`).join('')}<text x="${compact?48:64}" y="16">件／天</text>${compact?'':`<text x="252" y="40" text-anchor="middle">已知历史</text><line x1="443" y1="48" x2="443" y2="264" stroke="#819ba8" stroke-dasharray="4 5"/><polyline points="${line(history,0)}" fill="none" stroke="#8098a6" stroke-width="2.5"/>`}<text x="${compact?200:650}" y="40" text-anchor="middle">28 天预测与实际对照</text><polyline points="${path(actual)}" fill="none" stroke="#17324d" stroke-width="2.6"/><polyline points="${path(base)}" fill="none" stroke="#af8038" stroke-width="2.5" stroke-dasharray="5 4"/><polyline points="${path(predicted)}" fill="none" stroke="#087f9d" stroke-width="3"/><line id="m5-cursor${compact?'-mobile':''}" x1="${x(offset+day)}" x2="${x(offset+day)}" y1="48" y2="${bottom}" stroke="#087f9d" opacity=".35"/>${ticks.map(i=>`<text x="${x(i)}" y="${compact?225:291}" text-anchor="${compact&&i===27?'end':'middle'}">${(compact?window.dates[i]:i<28?window.history_dates[i]:window.dates[i-28]).slice(5)}</text>`).join('')}</svg>`;
}
export async function renderM5(host,isCurrent) {
 host.innerHTML='<p class="loading-copy">正在核验 M5 预测案例…</p>';
 try {
  const response=await fetch('./m5-results/manifest.json',{cache:'no-store'});
  if(!response.ok)throw new Error('本构建未包含 M5 本地研究数据。请在本地完成案例导出后查看；公开展示许可仍待确认。');
  const manifest=await response.json();
  if(manifest.schema!==1 || manifest.mode!=='local_research_preview' || manifest.public_export_allowed!==false)throw new Error('案例清单格式不符');
  const cache=new Map();
  async function resource(key){
   if(cache.has(key))return cache.get(key);
   const promise=(async()=>{
    const spec=manifest.resources[key];
    if(!spec || !new RegExp(`^${manifest.version}/[a-z0-9-]+\\.json$`).test(spec.path) || !/^[a-f0-9]{16}$/.test(manifest.version))throw new Error('案例资源路径无效');
    const res=await fetch(`./m5-results/${spec.path}`);if(!res.ok)throw new Error('案例文件缺失');
    const bytes=await res.arrayBuffer();if(!crypto.subtle)throw new Error('请使用本机或 HTTPS 访问以核验数据');
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(sha!==spec.sha256)throw new Error('案例校验失败，请重新导出完整数据包');
    return JSON.parse(new TextDecoder().decode(bytes));
   })();cache.set(key,promise);return promise;
  }
  const [overview,catalog]=await Promise.all([resource('overview'),resource('catalog')]);if(!isCurrent())return;
  if(overview.run_id!==manifest.run_id || catalog.length!==overview.scope.series)throw new Error('案例版本或商品范围不一致');
  const params=new URLSearchParams(location.hash.split('?')[1]||'');
  const view=params.get('view')||'experience';
  if(['models','report','training'].includes(view))return renderM5Details(host,overview,manifest,M5_NAMES,view);
  let origin=overview.windows.some(w=>w.origin===Number(params.get('window')))?Number(params.get('window')):1913;
  let model=Object.hasOwn(M5_NAMES,params.get('model'))?params.get('model'):'lgbm_tweedie_core';
  let level=['store','category','item'].includes(params.get('level'))?params.get('level'):'store';
  let item=catalog.find(p=>p.id===params.get('item'))||catalog[0];
  let category=Object.hasOwn(CATEGORY,params.get('category')) && params.get('category')!=='store'?params.get('category'):'FOODS';
  let baseline=Object.hasOwn(M5_NAMES,params.get('baseline')) && params.get('baseline')!=='lgbm_tweedie_core'?params.get('baseline'):frozenBaseline(overview), generation=0, day=0;
  host.innerHTML=`<div class="breadcrumb">销量预测<span>/</span>M5 零售案例</div><header class="m5-heading"><div><h1>M5 商品销量预测</h1><p>选择门店、品类或商品，比较未来 28 天的保存预测、实际销量与基线。</p></div><span class="badge">本地研究预览</span></header><p class="m5-context">M5 零售数据 · CA_1 门店 · 全部 3,049 个商品 · 本地 CPU 实训与结果回放</p><section class="m5-workbench" aria-label="M5 预测工作台"><div class="m5-controls"><label>评估窗口<select id="m5-window">${overview.windows.map(w=>`<option value="${w.origin}">${w.kind==='reserved_consumed'?'冻结后保留窗口':'开发窗口'} · ${w.dates[0]}～${w.dates[27]}</option>`).join('')}</select></label><label>预测模型<select id="m5-model">${Object.entries(M5_NAMES).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>对照基线<select id="m5-baseline">${Object.entries(M5_NAMES).filter(([id])=>id!=='lgbm_tweedie_core').map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label></div><div class="m5-granularity" role="group" aria-label="查看销量粒度">${[['store','门店总量'],['category','品类合计'],['item','商品明细']].map(([id,name])=>`<button data-level="${id}">${name}</button>`).join('')}</div><div id="m5-detail-controls" class="m5-detail-controls"><label id="m5-category-label">品类<select id="m5-category">${Object.entries(CATEGORY).filter(([id])=>id!=='store').map(([id,name])=>`<option value="${id}">${name}（${id}）</option>`).join('')}</select></label><label id="m5-search-label">查找商品<input id="m5-search" type="search" placeholder="输入商品编号，如 FOODS_1_001"/></label><label id="m5-item-label">商品<select id="m5-item"></select></label></div><div id="m5-plot"></div></section><section id="m5-comparison" class="m5-section"></section><section id="m5-method" class="m5-section"></section><section class="m5-section m5-reading"><h2>评估指标与适用范围</h2><div><article><h3>层级误差与商品日误差</h3><p>层级误差同时考察商品、部门、品类与门店汇总。商品日 WAPE 则统计每个商品每天的绝对误差。两者目标不同，不能互相替代，也不能用 1 − WAPE 表示准确率。</p></article><article><h3>不同指标下的模型表现</h3><p>中位数在商品日 WAPE 上仍有优势，但会明显低估总量。商品误差可能在汇总时相互抵消，门店总量与单品表现需要分别评估。</p></article><article><h3>离线评估范围</h3><p>本例采用竞赛方法中的非递归门店建模思路，是自行训练的缩减实现。只有一个门店与一次保留窗口，没有证明线上补货收益，也不能外推到所有门店。</p></article></div></section><footer class="showcase-source"><p>数据与方法来源：<a href="https://github.com/Mcompetitions/M5-methods" target="_blank" rel="noreferrer">M5 官方资料</a>。本页仅展示本项目训练结果与同范围基线，不展示官方获奖成绩。</p><details><summary>评估边界、运行记录与使用范围</summary><p>两个开发窗口用于比较方案，方案冻结后读取一次 2016-04-25～2016-05-22 保留窗口。该窗口现已消耗；它是竞赛公开验证时段，不是私榜成绩。单门店 scope WRMSSE 也不是完整竞赛得分。</p><p>未来日历、节假日及提供的周价格按竞赛已知条件使用；实际业务中需要确认这些信息能否提前取得。商品只有真实编号与品类，没有补造商品名称或图片。</p><p>本页为本地研究预览。数据对外使用许可待核实，尚未随网站公开发布。</p><p>运行 ${esc(manifest.run_id)}；数据包 ${esc(manifest.version)}。训练和逐条预测均已核验。<a href="./m5-results/${manifest.resources.overview.path}" download="M5-本地研究报告.json">下载本地案例报告</a></p></details></footer>`;
  function sync(){
   const q=new URLSearchParams({case:'m5',view:'experience',window:String(origin),model,baseline,level});if(level!=='store')q.set('category',category);if(level==='item')q.set('item',item.id);
   history.replaceState(null,'',`#forecast?${q}`);
  }
  function itemOptions(){
   const search=host.querySelector('#m5-search').value.trim().toLowerCase();
   const matches=catalog.filter(p=>p.category===category && (!search || p.id.toLowerCase().includes(search)));
   const select=host.querySelector('#m5-item');select.innerHTML=matches.length?matches.map(p=>`<option value="${esc(p.id)}">${esc(p.item)} · ${esc(p.department)}</option>`).join(''):'<option value="">没有匹配商品</option>';
   select.disabled=!matches.length;
   if(!matches.some(p=>p.id===item?.id))item=matches[0]||null;
   if(item)select.value=item.id;
  }
  if(level==='item')category=item.category;
  host.querySelector('#m5-category').value=category;
  async function draw(){
   const ticket=++generation, window=overview.windows.find(w=>w.origin===origin);
   for(const [id,value] of [['window',origin],['model',model],['baseline',baseline]])host.querySelector(`#m5-${id}`).value=value;
   host.querySelectorAll('[data-level]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.level===level));b.classList.toggle('active',b.dataset.level===level);});
   host.querySelector('#m5-category-label').hidden=level==='store';host.querySelector('#m5-search-label').hidden=level!=='item';host.querySelector('#m5-item-label').hidden=level!=='item';
   const plot=host.querySelector('#m5-plot');plot.innerHTML='<p class="loading-copy">读取保存的预测…</p>';
   let sample,title;
   try{
    if(level==='item'){
     if(!item)throw new Error('没有匹配商品，请修改编号或选择其他品类');
     const bundle=await resource(`items-${origin}-${item.shard}`);if(ticket!==generation||!isCurrent())return;
     if(bundle.run_id!==manifest.run_id||bundle.origin!==origin||!bundle.items[item.id])throw new Error('商品预测版本不一致');
     sample=bundle.items[item.id];title=`${CATEGORY[item.category]} / ${item.item}`;
    }else{sample=window.groups[level==='store'?'store':category];title=CATEGORY[level==='store'?'store':category];}
    const metrics=seriesMetrics(sample.actual,sample.predictions[model]),baseMetrics=seriesMetrics(sample.actual,sample.predictions[baseline]);
    sync();
    plot.innerHTML=`<div class="m5-chart-title"><h2>${esc(title)}</h2><span>${sample.series.toLocaleString('zh-CN')} 个商品 · 件／天</span></div><div class="m5-legend"><span class="actual">实际销量</span><span class="prediction">${M5_NAMES[model]}</span><span class="baseline">${M5_NAMES[baseline]}</span></div><div class="m5-chart-scroll">${m5Chart(sample,model,baseline,window,day)}</div><div class="m5-chart-mobile">${m5Chart(sample,model,baseline,window,day,true)}<p>手机视图聚焦未来 28 天；桌面同时显示前 28 天历史。</p></div><div class="m5-day"><label for="m5-day">查看每天的差距</label><input id="m5-day" aria-label="查看预测日" type="range" min="0" max="27" value="${day}"/><output id="m5-day-value" for="m5-day" aria-live="polite"></output></div><div class="m5-local-metrics"><div><span>当前视图 WAPE</span><strong>${pct(metrics.wape)}</strong><small>对照 ${pct(baseMetrics.wape)}</small></div><div><span>当前视图总量偏差</span><strong>${metrics.bias==null?'不适用':`${metrics.bias>0?'+':''}${pct(metrics.bias)}`}</strong><small>负值表示低估</small></div><div><span>28 天预测 / 实际</span><strong>${number(metrics.predicted)} / ${number(metrics.total)}</strong><small>件；未将预测强行取整</small></div></div><p class="m5-caption">${level==='item'?'按品类和编号浏览全部商品，默认按编号排列，没有挑选预测最好的商品。零销量窗口的 WAPE 显示不适用。':'先将所选范围内各商品的日销量相加，再计算当前视图误差；这与下方逐商品评分的 WAPE 不同。'}曲线为已训练结果回放，切换不会重新训练。</p><details class="m5-daily"><summary>查看 28 天逐日数值</summary>${table(['日期','实际（件）','当前预测（件）','对照预测（件）'],sample.actual.map((v,i)=>`<tr><td>${window.dates[i]}</td><td>${number(v)}</td><td>${number(sample.predictions[model][i])}</td><td>${number(sample.predictions[baseline][i])}</td></tr>`),'逐日预测数值')}</details>`;
    const updateDay=()=>{host.querySelector('#m5-day-value').textContent=`${window.dates[day]}：实际 ${number(sample.actual[day])} 件，预测 ${number(sample.predictions[model][day])} 件，对照 ${number(sample.predictions[baseline][day])} 件`;for(const [id,x] of [['m5-cursor',62+(28+day)*14.1],['m5-cursor-mobile',48+day*11]]){const cursor=host.querySelector(`#${id}`);cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);}};updateDay();host.querySelector('#m5-day').oninput=e=>{day=Number(e.target.value);updateDay();};
   }catch(error){if(ticket===generation&&isCurrent())plot.innerHTML=`<p class="m5-empty" role="alert">${esc(error.message)}。本视图不使用替代结果。</p>`;}
   if(ticket!==generation||!isCurrent())return;
   const bestBaseline=frozenBaseline(overview),lift=1-window.models.lgbm_tweedie_core.scope_wrmsse/window.models[bestBaseline].scope_wrmsse;
   const minima={};for(const key of ['scope_wrmsse','wape'])minima[key]=Math.min(...Object.values(window.models).map(v=>v[key]));
   host.querySelector('#m5-comparison').innerHTML=`<div class="m5-section-heading"><div><h2>当前窗口的模型对比</h2><p>${window.kind==='reserved_consumed'?'冻结后保留窗口':'用于选模的开发窗口'} · ${window.dates[0]}～${window.dates[27]} · 全部 3,049 个商品</p></div><div class="m5-lift"><strong>${pct(Math.abs(lift))}</strong><span>LightGBM 层级误差${lift>=0?'降低':'增加'}<br/>相对开发期最强均值基线</span></div></div>${table(['模型','层级误差 ↓','商品日 WAPE ↓','总量偏差'],Object.entries(M5_NAMES).map(([id,name])=>{const m=window.models[id];return `<tr class="${id===model?'selected-row':''}"><th scope="row">${name}</th><td class="${m.scope_wrmsse===minima.scope_wrmsse?'m5-best':''}">${m.scope_wrmsse.toFixed(5)}</td><td class="${m.wape===minima.wape?'m5-best':''}">${pct(m.wape)}</td><td>${m.bias>0?'+':''}${pct(m.bias)}</td></tr>`;}),'全部商品同范围模型对照')}<p class="m5-caption">绿色标出该列最低误差，当前模型以浅底标记。此表始终是全体商品结果，不随上方商品或品类选择变化。主指标为本门店范围的 12 层级 scope WRMSSE；只用于同范围比较。</p><p class="m5-tradeoff">LightGBM 改善了层级误差；中位数基线的商品日 WAPE 仍更低。两项指标分别反映层级表现和商品日绝对误差。</p>`;
   const guide=descriptions[model];host.querySelector('#m5-method').innerHTML=`<h2>当前模型的预测方法</h2><p class="m5-method-name">${M5_NAMES[model]}</p><ol class="guide-flow"><li><strong>输入</strong><p>${guide[0]}。</p></li><li><strong>学习与处理</strong><p>${guide[1]}</p></li><li><strong>输出与取舍</strong><p>未来 28 天的每日销量。${guide[2]}</p></li></ol><details><summary>与 M5 冠军方案是什么关系？</summary><p class="m5-caption">冠军以 LightGBM 为核心，按门店、门店×品类、门店×部门分别建模，再组合递归与非递归两种方式，共 220 个模型，每条销量序列平均使用 6 个模型的预测。本例只实现 CA_1 单门店的非递归 Tweedie 分支，缩减了特征与训练预算，不是完整冠军复现。</p><a class="text-link" href="https://statmodeling.stat.columbia.edu/wp-content/uploads/2021/10/M5_accuracy_competition.pdf" target="_blank" rel="noreferrer">查看赛事论文中的方案说明</a></details><details><summary>查看 LightGBM 的 42 个输入特征与训练记录</summary><div class="m5-feature-map"><article><h3>商品结构 · 3 项</h3><p>商品、部门、品类编码。</p></article><article><h3>销量历史 · 25 项</h3><p>28～42 天滞后；7／14／30／60／180 天滚动均值和标准差，全部移位 28 天。</p></article><article><h3>已知日历 · 11 项</h3><p>星期、月份、年份、月内日期、周序号、周末、SNAP，以及 4 项节日字段。</p></article><article><h3>价格 · 3 项</h3><p>提供的周价格、相对 28 天前价格、截至滞后时点的历史均价。</p></article></div><p class="m5-caption">同一折最近 1,095 天训练，${number(window.cost.train_rows)} 行；1,000 棵树，127 叶；CPU 两线程拟合 ${(window.cost.fit_seconds/60).toFixed(1)} 分钟。价格与日历确实进入模型，但本轮没有做特征消融，不能据此认定某一类特征带来了多少提升。</p></details>`;
  }
  for(const id of ['window','model','baseline'])host.querySelector(`#m5-${id}`).onchange=e=>{if(id==='window')origin=Number(e.target.value);else if(id==='model')model=e.target.value;else baseline=e.target.value;draw();};
  host.querySelectorAll('[data-level]').forEach(b=>b.onclick=()=>{level=b.dataset.level;if(level==='item')itemOptions();draw();});
  host.querySelector('#m5-category').onchange=e=>{category=e.target.value;itemOptions();draw();};
  host.querySelector('#m5-search').oninput=()=>{itemOptions();draw();};
  host.querySelector('#m5-item').onchange=e=>{item=catalog.find(p=>p.id===e.target.value);draw();};
  itemOptions();await draw();
 }catch(error){if(isCurrent())host.innerHTML=`<section class="report-panel"><h1>M5 案例暂未就绪</h1><p>${esc(error.message)}</p><p>不会以其他案例或虚构指标代替。</p><a class="text-link" href="#advanced">查看已有进阶实验</a></section>`;}
}

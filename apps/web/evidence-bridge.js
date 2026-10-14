// Customer-facing conclusions use frozen, explicitly scoped evidence only.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
const pct=n=>`${(100*n).toFixed(2)}%`;
const pp=n=>`${n>0?'+':''}${(100*n).toFixed(2)} 个百分点`;
const table=(heads,rows,label)=>`<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;

export function ablationEvidence(study){
 const ids=['behavior','attributes','combined','full'],rows=ids.map(id=>study.models[id]);
 const n=rows[0].sessions;
 if(!Number.isInteger(n)||n<=0||rows.some(r=>r.sessions!==n||r.retrieved!==rows[0].retrieved||Object.values(r.states).reduce((a,b)=>a+b,0)!==n||Math.abs(r['recall@10']-r.states.rank_1_10/n)>1e-9))throw new Error('特征对照的人群、候选或命中计数不一致');
 return {n,rows,attributeGain:rows[2]['recall@10']-rows[0]['recall@10'],crossGain:rows[3]['recall@10']-rows[2]['recall@10'],crossMrr:rows[3]['mrr@100']-rows[2]['mrr@100']};
}
export function dressipiEvidence(study){
 if(!study)return '<section class="report-panel"><h2>特征增益证据暂缺</h2><p>当前结果包未包含受控特征实验，不能量化属性的独立增益。</p></section>';
 const e=ablationEvidence(study),full=e.rows[3];
 const labels=['行为统计','仅属性与会话上下文','行为＋属性','再加入三项匹配交叉'];
 const cold=study.diagnostics.groups.target_purchase_count.find(g=>g.group==='0');
 return `<section class="report-panel evidence-bridge" aria-label="Dressipi 特征增益与适用条件"><h2>商品属性带来的改善与限制</h2><p>在相同 ${num(e.n)} 个开发会话、同一候选池与训练参数下，行为统计加入属性信息，前 10 命中比例变化 <strong>${pp(e.attributeGain)}</strong>。继续加入三项匹配交叉后，MRR 变化 ${e.crossMrr>0?'+':''}${e.crossMrr.toFixed(5)}，但前 10 命中变化 <strong>${pp(e.crossGain)}</strong>。</p>${table(['排序输入','前 10 命中会话','前 10 命中比例','MRR@100'],e.rows.map((r,i)=>[labels[i],`${r.states.rank_1_10} / ${e.n}`,pct(r['recall@10']),r['mrr@100'].toFixed(5)]),'固定候选的特征增益')}<p class="small-note">这里对照的是 LightGBM 的四组输入，不等于体验页四种推荐方法之间的配对。仅属性输入并未超过行为统计；多加特征也不保证所有指标改善。</p><div class="depth-duel"><section><h3>适合进一步验证的业务条件</h3><p>有购买前的完整浏览会话、可对齐的商品属性和购买标签，且推荐目标是本次会话购买。可交付候选生成、属性匹配、排序模型及分组评估。</p><p>属性编码可以匿名，但必须跨商品一致；名称和图片不是本例模型输入。</p></section><section><h3>目前仍然受限的场景</h3><p>完整模型有 ${full.states.not_retrieved} / ${e.n} 个购买目标未进入候选，增加排序特征不能解决这些遗漏。${cold?`历史购买次数为零的目标组有 ${cold.sessions} 个会话，前 10 命中 ${pct(cold['recall@10'])}。`:''}新商品与稀疏交互需要单独验证候选覆盖。</p><p>这些失败组只保存了完整模型统计，尚不能证明属性在每个组都有效，也不能解释某个会话为何改善。</p></section></div><details class="depth-calculation"><summary>输入变化、实验控制与待补证据</summary><p>行为 6 项 → 行为＋属性 9 项 → 加入共享属性数、最后商品属性 Jaccard、匹配浏览商品数，共 12 项。固定训练／验证会话、三路联合候选、标签及参数；行为组的候选也含属性召回，所以本实验仅隔离候选内排序输入，不是端到端删除属性的实验。</p><p>这是已有反馈的开发验证，未提供重复训练置信区间。下一项能影响方案选择的实验是：固定候选与训练预算，比较各输入组合在零购买历史、属性缺失及长会话组的增益；当前不将分组相关性作为特征归因。</p></details><a class="text-link" href="#recommend?case=dressipi&view=report">查看同一批会话的失败分组与召回扩展 →</a> · <a class="text-link" href="#recommend?case=dressipi&view=models">查看输入定义和受控实验 →</a></section>`;
}

export function intervalContext(data,{origin,model,level,category}){
 const windows=data.report.windows,window=windows.find(w=>w.origin===Number(origin));
 const interval=window?.models[model]?.intervals?.['90'];
 const group=level==='store'?'store':category;
 return {window,interval,group,aggregate:level==='item'?null:interval?.aggregates?.[group]||null,
  reason:!window?'当前点预测窗口未进行区间评估':!window.models[model]?'当前方法未进行区间评估':!interval?'当前窗口只用于初始校准':level==='item'?'未导出当前单品的预测区间':null};
}
export function m5Evidence(data,selection){
 if(!data)return '<section class="report-panel"><h2>稳定性与区间证据暂缺</h2><p>当前结果包没有区间报告，不能为点预测添加置信范围。</p></section>';
 const c=intervalContext(data,selection),windows=data.report.windows;
 const wins=windows.filter(w=>w.models.lgbm_tweedie_core.scope_wrmsse<w.models.weekday_mean_8w.scope_wrmsse).length;
 const matched=c.aggregate;
 const q=new URLSearchParams({case:'m5',view:'report'});
 if(c.interval){q.set('interval_window',String(selection.origin));q.set('interval_model',selection.model);q.set('interval_group',c.group);q.set('interval_level','90');}
 const intervalText=matched?`当前${selection.level==='store'?'门店':'品类'}、当前模型、${c.window.dates[0]}～${c.window.dates.at(-1)}：名义 90% 区间实际覆盖 ${pct(matched.metrics.coverage)}，平均宽度 ${num(matched.metrics.width)} 件，${matched.metrics.n} 个聚合日。聚合区间单独校准，不是商品区间相加。`:`${c.reason}。${c.interval?'完整报告可查看同窗口、同模型的品类聚合区间；它不能代替这个商品的区间。':'完整报告展示较早开发窗口的区间，不代表当前曲线的波动范围。'}`;
 return `<section class="report-panel evidence-bridge" aria-label="M5 稳定性与适用条件"><h2>当前预测的区间证据与应用条件</h2><p class="depth-verdict"><strong>${matched?'有同范围的区间评估':'当前视图没有对应的区间评估'}</strong><br>${intervalText}</p><p>固定 LightGBM 对同星期 8 周均值的四次开发回测：层级误差 ${wins} / ${windows.length} 个窗口更低。这是全门店 3,049 商品的固定配对，不随上方模型、基线或单品选择改变。<a class="text-link" href="#forecast?${q}">${matched?'查看同窗口、同模型的区间和稳定性':'查看已评估范围及稳定性'} →</a></p><div class="depth-duel"><section><h3>可以迁移的建模方法</h3><p>将历史销量、商品结构、提前已知的日历与价格用于 28 天预测；按商品和汇总层级分别评分，以较早窗口误差校准后续区间。定制交付可包含批量预测、基线评估及风险范围。</p><p>业务需要连续商品日销量、稳定商品编码，并确认未来价格与活动计划在预测时可得。</p></section><section><h3>尚不能承诺的效果</h3><p>单门店开发结果不能保证新门店、突发促销或缺货时仍有效。历史销量不等于无约束需求；预测区间也不是安全库存或整段 28 天同时覆盖的保证。</p><p>价格和日历确已进入模型，但尚无受控消融，不能把总增益归给某类特征。中位数在商品日 WAPE 上的优势仍保留。</p></section></div><details class="depth-calculation"><summary>下一项特征验证的设计</summary><p>仅在允许的开发窗口固定商品、训练样本、目标函数和预算，对照销量历史、加入日历、加入价格；同时报告层级误差、商品日误差、总量偏差与分组表现。最终保留窗口已消耗，不重新开启选模。此实验尚未执行，当前特征重要性不能替代它。</p></details></section>`;
}

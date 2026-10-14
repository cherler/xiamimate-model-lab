import {CLASSIFICATION_MODELS as MODELS,applyPolicy,confusionCounts} from './classification-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:4});
const pct=v=>v==null?'不定义':`${(100*v).toFixed(2)}%`;
const signed=v=>`${v>0?'+':''}${num(v)}`;
const table=(headers,rows,label)=>`<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const TRANSITIONS={corrected_fp:'纠正误标正常邮件',corrected_fn:'找回原先漏掉的垃圾邮件',new_fp:'新增误标正常邮件',new_fn:'新增漏掉垃圾邮件',both_correct:'两侧均正确',both_wrong:'两侧均错误'};
export const OUTCOMES={tp:'正确识别垃圾邮件',fp:'误标正常邮件',fn:'漏掉垃圾邮件',tn:'正常邮件未标记'};
export function policyPair(rows,model,baseline,currentPolicy,basePolicy){
 if(!rows.length||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>![0,1].includes(r.label)))throw new Error('分类配对样本无效');
 const selected=applyPolicy(rows,model,currentPolicy),baseSelected=applyPolicy(rows,baseline,basePolicy);
 const counts=Object.fromEntries(Object.keys(TRANSITIONS).map(k=>[k,0]));
 const outcome=(row,set)=>set.has(row.id)?(row.label?'tp':'fp'):(row.label?'fn':'tn');
 const transitions=rows.map(row=>{
  const current=outcome(row,selected),base=outcome(row,baseSelected),correct=['tp','tn'].includes(current),wasCorrect=['tp','tn'].includes(base);
  const status=correct&&wasCorrect?'both_correct':!correct&&!wasCorrect?'both_wrong':correct?(row.label?'corrected_fn':'corrected_fp'):(row.label?'new_fn':'new_fp');
  counts[status]++;return {row,current,base,status};
 });
 return {selected,baseSelected,counts,transitions,current:confusionCounts(rows,selected),base:confusionCounts(rows,baseSelected)};
}
export function pairForState(payload,state,frozen=false){
 const policy=id=>({mode:frozen?'threshold':state.mode,threshold:payload.report.thresholds[id],share:state.share});
 const current=policy(state.model),base=policy(state.baseline);
 if(!frozen&&state.mode==='threshold'){current.threshold=state.threshold;base.threshold=state.baseThreshold;}
 return policyPair(payload.rows[state.split],state.model,state.baseline,current,base);
}
const comparisonTable=(pair,model,baseline)=>table(['方法','待复核','误标正常 FP ↓','漏掉垃圾 FN ↓','精确率','召回率'],[[MODELS[baseline],pair.base],[MODELS[model],pair.current]].map(([name,c])=>[name,c.selected,c.fp,c.fn,pct(c.precision),pct(c.recall)]),'同分区模型与处理策略对照');
export function classificationPair(payload,state,pair){
 const frozen=pairForState(payload,state,true),n=payload.rows[state.split].length;
 const isFrozen=state.mode==='threshold'&&state.threshold===payload.report.thresholds[state.model]&&state.baseThreshold===payload.report.thresholds[state.baseline];
 return `<section class="m5-section classification-pair"><h2>识别改善与新增错误</h2><p>${state.split==='test'?'已完成的一次性留出评估':'用于选模的开发验证'} · 全部 ${n} 条 · 对照 ${MODELS[state.baseline]} → 当前 ${MODELS[state.model]}。${state.mode==='capacity'?`两侧各分配 ${pair.current.selected} 个复核名额；同分仍按冻结规则排序。`:`各自使用所填阈值，不假定不同模型的同一分值对应相同误报水平。`}</p><div class="depth-verdict"><strong>漏掉垃圾邮件${pair.base.fn>=pair.current.fn?'减少':'增加'} ${Math.abs(pair.base.fn-pair.current.fn)} 条，误标正常邮件变化 ${signed(pair.current.fp-pair.base.fp)} 条</strong><p>待复核数量变化 ${signed(pair.current.selected-pair.base.selected)} 条。更多标记不等于更好的方案。${isFrozen?'当前两侧均为验证集冻结阈值。':'当前为自选策略回放，不改写冻结阈值成绩。'}</p></div>${comparisonTable(pair,state.model,state.baseline)}${table(['相对对照的变化','记录数'],Object.entries(TRANSITIONS).map(([k,label])=>[label,pair.counts[k]]),'全部样本错误迁移')}<p class="small-note">以上六类互斥，合计 ${n} 条。纠正旧错误与引入新错误同时保留；样本筛选不改变这些全量计数。</p><details class="depth-calculation"><summary data-calculation="classify:spambase">冻结阈值对照与错误迁移计算</summary>${comparisonTable(frozen,state.model,state.baseline)}<p>此表固定使用各模型验证集阈值。当前误报 = 对照误报 − 纠正误报 + 新增误报；当前漏报 = 对照漏报 − 找回漏报 + 新增漏报。复核数量由 TP＋FP 决定。指标和迁移由同分区逐条冻结分数复算；改变阈值或名额不改变原始排序 AP。</p></details></section>`;
}
export function mailDuel(sample,state,pair){
 const t=pair.transitions.find(t=>t.row.id===sample.id);
 const column=(model,outcome,selected,threshold,role)=>`<section><p class="depth-role">${role}</p><h3>${MODELS[model]}</h3><p><strong>${selected.has(sample.id)?'进入待复核队列':'不进入待复核队列'} · ${OUTCOMES[outcome]}</strong></p><p>校准后概率估计 ${pct(sample.scores[model])}。${state.mode==='threshold'?`与阈值 ${num(threshold)} 比较，达到即标记。`:`按全分区分数与稳定同分规则排序，共取前 ${selected.size} 条。`}</p><details><summary>精确分数与决策依据</summary><p>校准后分数 ${sample.scores[model]}；${state.mode==='threshold'?`阈值 ${threshold}`:'固定名额不等同于固定概率阈值'}。${model==='rules'?'规则使用下方四项输入的触发比例，再经校准映射。':model==='logistic'?'由训练集变换后的全部保留特征加权打分，再经校准映射。':'使用全部保留特征的树模型及交互打分，再经校准映射。'}本页未导出逐样本特征贡献，不能由全局权重推断这封邮件的判定原因。</p></details></section>`;
 return `<p class="depth-verdict"><strong>${TRANSITIONS[t.status]}</strong> · 两侧读取同一份 ${sample.features.length} 项公开统计输入；真实标签仅用于事后核对。</p><div class="depth-duel">${column(state.baseline,t.base,pair.baseSelected,state.baseThreshold,'对照方法')}${column(state.model,t.current,pair.selected,state.threshold,'当前方法')}</div>`;
}
export function classificationConditions(state){
 return `<section class="m5-section"><h2>适用条件与可交付内容</h2><div class="depth-duel"><section><h3>可以迁移的建模能力</h3><p>将已有标签与可稳定提取的邮件特征转换为评分、复核队列和错误诊断；按误报容忍度或人工名额设计策略，分别验证排序、概率和最终判定。</p><p>可交付数据切分与审计、规则基线、评分模型、校准评估及批量评分结果。本案例已完成这些离线环节；邮箱集成与业务试点需另行实施。</p></section><section><h3>应用前需要验证的条件</h3><p>需要有代表性的正常／垃圾标签、稳定特征提取和可确认的复核流程。本例没有正文、时间或发件人，不能证明对新邮箱、未来邮件和现代诈骗文本仍有效。</p><p>规则只有四项输入，学习模型有 53 项；两者对照同时改变输入和方法，不能把提升归给某一个特征。特征重要性不是受控消融，也不是某封邮件的解释。</p></section></div><a class="text-link" href="#classify?case=spambase&view=report&split=${state.split}&model=${state.model}">查看全体排序与校准证据 →</a> · <a class="text-link" href="#classify?case=spambase&view=models">查看输入与训练方法 →</a></section>`;
}

export function policyCost(counts,costs){
 if(['fp','fn','review'].some(k=>!Number.isFinite(costs[k])||costs[k]<0||costs[k]>1000000))throw new Error('成本请输入 0～1,000,000 的有限数字');
 if(['fp','fn','selected'].some(k=>!Number.isInteger(counts[k])||counts[k]<0))throw new Error('错误与复核计数无效');
 const fp=counts.fp*costs.fp,fn=counts.fn*costs.fn,review=counts.selected*costs.review;
 return {fp,fn,review,total:fp+fn+review};
}
export function capacityTradeoffs(payload,state){
 return [0,.05,.1,.2,.3,.5,1].map(share=>({share,pair:pairForState(payload,{...state,mode:'capacity',share})}));
}
export function classificationCosts(payload,state,pair){
 const a=policyCost(pair.current,state.costs),b=policyCost(pair.base,state.costs),gain=b.total-a.total;
 const controls=[['fp','每条误标的额外处理代价'],['fn','每条漏判的假设损失'],['review','每条标记的复核费用']];
 return `<section class="m5-section classification-cost"><h2>误标、漏判与复核量的成本取舍</h2><p>跟随上方同分区、同模型配对及策略。下面是<strong>假设成本单位／条</strong>，不是实际金额或实测收益；默认 10／1／0.1 仅为讲解情景。</p><form id="cls-cost-form"><div class="lesson-controls">${controls.map(([key,label])=>`<label for="cls-cost-${key}">${label}<input id="cls-cost-${key}" type="number" min="0" max="1000000" step="any" value="${state.costs[key]}" required/></label>`).join('')}</div><button class="outline" type="submit">应用成本假设</button><p id="cls-cost-error" role="status"></p></form><div class="depth-verdict"><strong>在这些假设下，当前方案成本${gain>=0?'减少':'增加'} ${num(Math.abs(gain))} 单位</strong><p>对照 ${num(b.total)} → 当前 ${num(a.total)} 单位。成本高低依赖你设定的代价，不能用此处回放选择新阈值后仍称独立留出成绩。</p></div>${table(['方法','误标额外代价','漏判损失','全部标记的复核费用','总假设成本'],[[MODELS[state.baseline],b],[MODELS[state.model],a]].map(([name,c])=>[name,num(c.fp),num(c.fn),num(c.review),num(c.total)]),'假设成本分项与合计')}<details class="depth-calculation"><summary>成本定义与固定名额下的取舍</summary><p>成本 = FP × ${state.costs.fp} + FN × ${state.costs.fn} + (TP＋FP) × ${state.costs.review}。复核费用覆盖全部被标记记录；误标代价仅指额外处理成本，两项不可重复录入相同费用。不假定人工一定能纠错，也不把标记视为删除邮件；尚无复核后准确率或实际损失数据。</p><p>以下固定名额占比预先列出；两侧每档名额相同，仍使用原评分。没有根据此留出集自动推荐最优名额或重训模型。</p>${table(['名额占比','每侧名额','对照误标／漏判','当前误标／漏判','对照成本','当前成本'],capacityTradeoffs(payload,state).map(({share,pair:p})=>[pct(share),p.current.selected,`${p.base.fp} / ${p.base.fn}`,`${p.current.fp} / ${p.current.fn}`,num(policyCost(p.base,state.costs).total),num(policyCost(p.current,state.costs).total)]),'相同复核预算下的错误与成本')}<p>真实决策还需要处理时长、误报投诉、漏报后果及复核结果。当前只能展示这些假设如何影响选择，不能证明实际经营收益。</p></details></section>`;
}
export function calibrationEvidence(report,state){
 const v=report[state.split][state.model],delta=v.calibrated.brier-v.raw.brier,ece=v.calibrated.ece-v.raw.ece;
 return `<section class="m5-section classification-calibration-evidence"><h2>概率估计的可靠性</h2><p>${MODELS[state.model]} · ${report.split_sizes[state.split]} 条${state.split==='test'?'留出记录':'开发验证记录'}。校准后概率误差（Brier，越低越好）${delta>0?'升高':delta<0?'降低':'持平'} ${Math.abs(delta).toFixed(6)}；分箱校准误差（ECE）${ece>0?'升高':ece<0?'降低':'持平'} ${Math.abs(ece).toFixed(6)}。${delta>0||ece>0?'至少一项校准指标变差，保留原始对照，不根据这批结果重新选择校准器。':'本分区的改善仍不保证新邮箱的概率可靠。'}</p>${table(['评分版本','排序 AP ↑','概率误差 Brier ↓','分箱误差 ECE ↓'],[['校准前',v.raw],['校准后',v.calibrated]].map(([name,m])=>[name,m.ap.toFixed(6),m.brier.toFixed(6),m.ece.toFixed(6)]),'当前模型校准取舍')}<p class="small-note">排序能力、概率可信度和最终判定分别检验。阈值变化不会提高 AP；概率 80% 不是对某封邮件有 80% 把握的业务保证。${state.model==='rules'?'规则校准前是条件触发比例，不是概率。':''}</p><details class="depth-calculation"><summary>校准方法及解释限制</summary><p>sigmoid 映射只在独立的 ${report.split_sizes.calibration} 条校准记录上拟合。Brier 是概率与 0／1 标签的均方误差；ECE 按十个等宽分箱计算。有限样本与分布差异都可能影响校准，但本实验没有隔离它们的各自贡献。改阈值只改变待复核集合，不改变保存分数与排序曲线。</p></details><a class="text-link" href="#classify?case=spambase&view=report&split=${state.split}&model=${state.model}">查看同分区、同模型的概率分箱与完整报告 →</a></section>`;
}

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
 return `<section class="m5-section classification-pair"><h2>识别改善与新增错误</h2><p>${state.split==='test'?'已完成的一次性留出评估':'用于选模的开发验证'} · 全部 ${n} 条 · 对照 ${MODELS[state.baseline]} → 当前 ${MODELS[state.model]}。${state.mode==='capacity'?`两侧各分配 ${pair.current.selected} 个复核名额；同分仍按冻结规则排序。`:`各自使用所填阈值，不假定不同模型的同一分值对应相同误报水平。`}</p><div class="depth-verdict"><strong>漏掉垃圾邮件${pair.base.fn>=pair.current.fn?'减少':'增加'} ${Math.abs(pair.base.fn-pair.current.fn)} 条，误标正常邮件变化 ${signed(pair.current.fp-pair.base.fp)} 条</strong><p>待复核数量变化 ${signed(pair.current.selected-pair.base.selected)} 条。更多标记不等于更好的方案。${isFrozen?'当前两侧均为验证集冻结阈值。':'当前为自选策略回放，不改写冻结阈值成绩。'}</p></div>${comparisonTable(pair,state.model,state.baseline)}${table(['相对对照的变化','记录数'],Object.entries(TRANSITIONS).map(([k,label])=>[label,pair.counts[k]]),'全部样本错误迁移')}<p class="small-note">以上六类互斥，合计 ${n} 条。纠正旧错误与引入新错误同时保留；下方样本筛选不改变这些全量计数。</p><details class="depth-calculation"><summary>冻结阈值对照与错误迁移计算</summary>${comparisonTable(frozen,state.model,state.baseline)}<p>此表固定使用各模型验证集阈值。当前误报 = 对照误报 − 纠正误报 + 新增误报；当前漏报 = 对照漏报 − 找回漏报 + 新增漏报。复核数量由 TP＋FP 决定。指标和迁移由同分区逐条冻结分数复算；改变阈值或名额不改变原始排序 AP。</p></details></section>`;
}
export function mailDuel(sample,state,pair){
 const t=pair.transitions.find(t=>t.row.id===sample.id);
 const column=(model,outcome,selected,threshold,role)=>`<section><p class="depth-role">${role}</p><h3>${MODELS[model]}</h3><p><strong>${selected.has(sample.id)?'进入待复核队列':'不进入待复核队列'} · ${OUTCOMES[outcome]}</strong></p><p>校准后概率估计 ${pct(sample.scores[model])}。${state.mode==='threshold'?`与阈值 ${num(threshold)} 比较，达到即标记。`:`按全分区分数与稳定同分规则排序，共取前 ${selected.size} 条。`}</p><details><summary>精确分数与决策依据</summary><p>校准后分数 ${sample.scores[model]}；${state.mode==='threshold'?`阈值 ${threshold}`:'固定名额不等同于固定概率阈值'}。${model==='rules'?'规则使用下方四项输入的触发比例，再经校准映射。':model==='logistic'?'由训练集变换后的全部保留特征加权打分，再经校准映射。':'使用全部保留特征的树模型及交互打分，再经校准映射。'}本页未导出逐样本特征贡献，不能由全局权重推断这封邮件的判定原因。</p></details></section>`;
 return `<p class="depth-verdict"><strong>${TRANSITIONS[t.status]}</strong> · 两侧读取同一份 ${sample.features.length} 项公开统计输入；真实标签仅用于事后核对。</p><div class="depth-duel">${column(state.baseline,t.base,pair.baseSelected,state.baseThreshold,'对照方法')}${column(state.model,t.current,pair.selected,state.threshold,'当前方法')}</div>`;
}
export function classificationConditions(state){
 return `<section class="m5-section"><h2>适用条件与可交付内容</h2><div class="depth-duel"><section><h3>可以迁移的建模能力</h3><p>将已有标签与可稳定提取的邮件特征转换为评分、复核队列和错误诊断；按误报容忍度或人工名额设计策略，分别验证排序、概率和最终判定。</p><p>可交付数据切分与审计、规则基线、评分模型、校准评估及批量评分结果。本案例已完成这些离线环节；邮箱集成与业务试点需另行实施。</p></section><section><h3>应用前需要验证的条件</h3><p>需要有代表性的正常／垃圾标签、稳定特征提取和可确认的复核流程。本例没有正文、时间或发件人，不能证明对新邮箱、未来邮件和现代诈骗文本仍有效。</p><p>规则只有四项输入，学习模型有 53 项；两者对照同时改变输入和方法，不能把提升归给某一个特征。特征重要性不是受控消融，也不是某封邮件的解释。</p></section></div><a class="text-link" href="#classify?case=spambase&view=report&split=${state.split}&model=${state.model}">查看全体排序与校准证据 →</a> · <a class="text-link" href="#classify?case=spambase&view=models">查看输入与训练方法 →</a></section>`;
}

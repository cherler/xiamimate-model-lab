import {CONDITIONS,SIGNAL_NAMES,diagnoseConditions,conditionAdvice} from './uci-conditions-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'不定义':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const pct=v=>v==null?'不定义':`${(100*v).toFixed(2)}%`;
const table=(heads,rows,title)=>`<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(title)}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const fraction=(value,n)=>n?`${value}/${n}`:'无样本';
const flags=s=>Object.keys(SIGNAL_NAMES).filter(k=>k!=='combined'&&s.flags[k]).map(k=>SIGNAL_NAMES[k]);
const link=(r,model,baseline)=>'#forecast?'+new URLSearchParams({case:'uci',task:'weekly_sales',model,baseline,item:r.item,origin:r.origin,view:'experience'});

export function conditionsHtml(rows,reliability,selected,model,baseline,summary,error=''){
 let diagnostic;
 try{diagnostic=diagnoseConditions(rows,reliability);}catch(e){return `<section class="report-panel uci-conditions"><h2>预测使用条件暂不可用</h2><p>${esc(e.message)}。不提供未经核验的可靠性建议。</p></section>`;}
 const record=diagnostic.records.find(r=>r.origin===selected.origin&&r.item===selected.item);
 if(!record||!record.models[model]||!record.models[baseline])return '<section class="report-panel uci-conditions"><h2>预测使用条件暂不可用</h2><p>当前商品、窗口或方法不在核验范围。</p></section>';
 const models=[...new Set([model,baseline])],name=m=>esc(summary.models[m].label),current=record.models[model],s=current.signals;
 const advice=conditionAdvice(s,current.interval),g=diagnostic.summary[model].groups.combined;
 const missing=!reliability?`<p class="validation-boundary">区间证据不可用：${esc(error||'未加载已核验结果')}。下方只保留历史和点预测诊断，区间实用性暂不判断。</p>`:'';
 const before=table(['检查项','起点前可见的事实','当前核查标记'],[
  ['近／远期周均量',`近两周 ${num(s.recent)} 件；此前六周 ${num(s.previous)} 件${s.ratio===null?'；此前为零，不计算倍数':`；${num(s.ratio)} 倍`}`,s.direction==='up'?'明显上升':s.direction==='down'?'明显下降':'未触发'],
  ['零销量日',`${s.zero_days}/56 天 · ${pct(s.zero_fraction)}`,s.flags.sparse?'需核查销售是否连续':'未触发'],
  ['八周销量波动',`周均 ${num(s.mean)} 件；变异系数 ${num(s.cv)}`,s.flags.volatile?'周量波动较大':s.cv===null?'历史全零，波动比例不定义':'未触发'],
  ['预测相对历史',`${name(model)} ${num(s.prediction)} 件；八周范围 ${num(s.min)}～${num(s.max)} 件`,s.flags.extrapolation?'超出历史范围':'范围内不等于可靠']
 ],'预测起点前四类检查');
 const actual=models.map(m=>{
  const r=record.models[m];return `<div class="uci-condition-result"><strong>${name(m)}</strong><p>绝对误差 ${num(r.error)} 件 · ${r.large?'超过':'未超过'}一周历史尺度</p><p class="small-note">${r.interval?`区间跨度 ${num(r.interval.width)} 件，相当于历史尺度的 ${num(r.interval.width_scale)} 倍；${r.interval.miss?'实际越界':'实际在区间内'}`:reliability?'残差积累不足，未提供区间':'区间证据未核验'}</p></div>`;
 }).join('');
 const outcome=current.large?(s.flags.combined?'有核查标记，实际仍发生较大误差。':'没有核查标记，但实际发生较大误差；仅靠这些历史检查无法提前识别本次失败。'):(s.flags.combined?'有核查标记，本次未发生约定的较大误差；标记不等于一定失败。':'本次未发生约定的较大误差；单条吻合不能证明未来可靠。');
 const groups=table(['方法／分组','商品周／窗口数','较大误差','实际超历史最大周量','WAPE','区间越界／可评估','宽区间／可评估'],models.flatMap(m=>['flagged','unflagged'].map(k=>{
  const v=diagnostic.summary[m].groups.combined[k];return [`${name(m)} · ${k==='flagged'?'有标记':'无标记'}`,`${v.n} / ${v.windows}`,fraction(v.large,v.n),fraction(v.spikes,v.n),pct(v.wape),reliability?fraction(v.misses,v.interval_n):'未核验',reliability?fraction(v.broad,v.interval_n):'未核验'];
 })),'全体有无标记的配对诊断');
 const individual=table(['单项检查（组间可重叠）','有标记','标记且大误差','标记但非大误差','无标记但大误差'],Object.keys(SIGNAL_NAMES).filter(k=>k!=='combined').map(k=>{
  const v=diagnostic.summary[model].groups[k];return [SIGNAL_NAMES[k],v.flagged.n,v.flagged.large,v.flagged.n-v.flagged.large,v.unflagged.large];
 }),'单项检查的误警与漏识别');
 const windows=table(['预测起点','核查标记／12','较大误差／12','WAPE','区间越界／可评估'],diagnostic.summary[model].windows.map(w=>[esc(w.origin),`${w.flagged}/12`,`${w.large}/12`,pct(w.wape),reliability?(w.interval_n?`${w.misses}/${w.interval_n}`:'残差积累期'):'未核验']),'全部12个窗口的信号表现');
 const replay=table(['商品／起点','预测前核查标记','事后绝对误差','区间跨度／历史尺度','事后越界'],diagnostic.records.map(r=>{
  const v=r.models[model];return [`<a href="${esc(link(r,model,baseline))}">${esc(r.item)} · ${esc(r.origin)}</a>`,esc(flags(v.signals).join('、')||'未触发'),`${num(v.error)} 件${v.large?' · 较大误差':''}`,v.interval?`${num(v.interval.width_scale)} 倍`:'未提供',v.interval?(v.interval.miss?'越界':'区间内'):'未评分'];
 }),'全部144商品周使用条件回放');
 return `<section class="report-panel uci-conditions" id="uci-use-conditions"><h2>本次预测的使用条件</h2><p class="small-note">${esc(selected.item)} · 预测起点 ${esc(selected.origin)} · 7 天总量。以下判断分开使用预测前信息与事后结果。</p>${missing}
 <div class="depth-duel"><section><p class="depth-role">预测时可见 · ${s.history_start}～${s.history_end}</p><h3>${advice.title}</h3><p>${advice.text}</p><p>${!reliability?'未核验区间，暂不判断范围是否足够实用。':advice.interval}</p><details><summary>查看四类核查依据</summary>${before}</details></section>
 <section><p class="depth-role">事后核验 · ${esc(record.origin)}～${esc(record.end)}</p><h3>${current.large?(s.flags.combined?'有标记，仍出现较大误差':'无标记，但出现较大误差'):'本次未出现约定的较大误差'}</h3><p>${outcome}</p><p>实际 ${num(current.actual)} 件${current.spike?'，超过过去八周最大周量；这是事后识别，预测前并不知道会出现尖峰':'，未超过过去八周最大周量'}。</p>${actual}<p class="small-note">“较大误差”指绝对误差大于 max(1，历史周均销量)＝${num(s.scale)} 件；不是业务通用验收标准。区间变宽不会改变预测准确性。</p></section></div>
 <div class="report-callout"><strong>这些检查尚不能作为自动放行预测的依据</strong><p>${name(model)} 全部 144 商品周中，有标记 ${g.flagged.n} 条，其中 ${g.flagged.large} 条发生较大误差，${g.flagged.n-g.flagged.large} 条未发生；${g.unflagged.n?`无标记 ${g.unflagged.n} 条中仍有 ${g.unflagged.large} 条较大误差`:'没有无标记样本，无法评价无标记组'}${reliability&&g.unflagged.interval_n?`。在无标记且可评估区间的 ${g.unflagged.interval_n} 条中，仍有 ${g.unflagged.misses} 条越界`:''}。不按本轮结果反复调门槛，也不将无标记称为低风险。</p></div>
 <details><summary>全体证据：标记、漏识别与区间宽度</summary>${groups}<p class="small-note">点预测覆盖全部 12 商品 × 12 起点；区间只用后 8 起点的 96 条。方法的“预测超出历史范围”标记可能不同，分组分母按各方法重新统计，组内指标不能直接当作同样本模型增益。“宽区间”指跨度／历史周均尺度 ≥ ${CONDITIONS.wide_interval_scale}，是固定诊断约定；业务可接受误差尚未提供。</p>${individual}<p class="small-note">“标记但非大误差”是相对此处误差定义的误警；“无标记但大误差”是漏识别。四项可同时出现，不能把各项人数相加当成总体；当前方法 ${name(model)}。</p>${windows}</details>
 <details><summary>全部 144 商品周回放与适用条件</summary>${replay}</details>
 <details><summary>诊断口径、缺少的信息与使用建议</summary><p>近期周均＝末 14 天销量÷2；前期周均＝前 42 天销量÷6。近期／前期≥2 或≤0.5，且周均绝对变化≥10件才标记变化；前期为零且近期≥10件时标记上升。零销量日≥28天、八周总量的总体标准差／均值≥1、预测严格超出历史八周最小／最大值，分别形成其余标记。任一命中只提示核查，不计算风险概率。</p><p>当前先核查销量口径、促销安排、库存可售与已知大单；本回放没有这些已核验输入，不能把它们认定为失败原因。零销量记录也不能区分无需求、停业或断货。${s.flags.combined?'核实标记对应的历史变化是否仍持续，再决定人工调整或补充数据。':'即使历史检查未触发，也需要核实业务是否出现历史外变化。'}</p><p>只有销量口径可信、历史足够、业务变化已核查，且误差范围能被实际决策承受时，预测才适合辅助人工判断需求规模。本案例未验证自动订货；区间上界不是订货建议。区间较窄也不等于可自动放行，缺失信息或可接受误差不明确时应人工复核。</p><p>协议在本轮交叉统计前固定，但原标签、选模与 E3 失败结果已经已知；144 条也不是独立重复试验。本轮只做开发诊断，不证明因果，不验证未来预警、不自动切换方法。原预测、区间与全部困难样本保持不变；28 天逐日任务不套用本周任务规则。</p></details></section>`;
}

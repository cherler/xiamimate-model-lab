import {median,ruleFor} from './monitoring-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'不适用':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:4});
const pct=v=>v==null?'不适用':`${(v*100).toFixed(2)}%`;
const signed=v=>`${v>0?'+':''}${num(v)}`;
const axes=['R · 距最近购买天数','F · 180 天订单数','M · 180 天正向金额（£）'];
const name=(p,method,g)=>method==='rule'?p.rule_names[g]:`群 ${g+1}`;
const table=(heads,rows,label)=>`<div class="table-scroll monitoring-table" role="region" tabindex="0" aria-label="${esc(label)}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export function distanceEvidence(model,row){
 const z=row.rfm.map((v,i)=>(Math.log1p(v)-model.scaler_center[i])/model.scaler_scale[i]);
 const centers=model.centers.map((c,group)=>{const parts=c.map((v,i)=>(z[i]-v)**2);return {group,parts,squared:parts.reduce((s,v)=>s+v,0)};});
 const order=[...centers].sort((a,b)=>a.squared-b.squared||a.group-b.group),[winner,runner]=order;
 return {z,centers,winner,runner,gap:runner.squared-winner.squared,advantages:winner.parts.map((v,i)=>runner.parts[i]-v)};
}
export function overlapCounts(rows){
 const matrix=Array.from({length:4},()=>[0,0,0,0]);for(const r of rows)matrix[r.rule][r.cluster]++;
 return {matrix,rules:matrix.map(r=>r.reduce((s,v)=>s+v,0)),clusters:matrix[0].map((_,i)=>matrix.reduce((s,r)=>s+r[i],0)),total:rows.length};
}
export function ruleTrace(row){
 const [r,f]=row.rfm,checks=[r>90,f===1,r<=30&&f>=3,true],chosen=checks.indexOf(true);
 return ['R > 90','否则 F = 1','否则 R ≤ 30 且 F ≥ 3','否则归入其他在购'].map((condition,i)=>({condition,result:i>chosen?'前项已命中，不再判断':i===chosen?'命中，采用此组':'不满足',chosen:i===chosen}));
}
export function customerPair(p,snap,person){
 const e=distanceEvidence(p.model,person),overlap=snap.rows.filter(r=>r.rule===person.rule&&r.cluster===person.cluster).length;
 const panels=['rule','cluster'].map(method=>{const g=snap.profiles[method][person[method]];return `<section><p class="depth-role">${method==='rule'?'固定业务规则':'K-means · 相似行为组合'}</p><h3>${esc(name(p,method,g.group))}</h3><p>${method==='rule'?'按 R 与 F 的顺序门槛判断，金额 M 不参与当前规则。':'R、F、M 经对数与稳健缩放后，分到距离最近的固定中心。'}</p><p>同组 ${g.n} 人，占本期 ${pct(g.share)}；正向销售额占比 ${pct(g.sales_share)}。</p><dl class="segment-profile">${axes.map((label,i)=>`<div><dt>${label}</dt><dd>该顾客 ${num(person.rfm[i])} ／ 同组中位数 ${num(g.median_rfm[i])}</dd></div>`).join('')}</dl></section>`;}).join('');
 return `<section class="m5-section segment-pair"><h2>同一顾客的规则与模型画像</h2><p>顾客 ${esc(person.id)} · ${esc(snap.origin)} 前 180 天。两侧使用同一份已发生交易，群画像来自本期全部 ${snap.rows.length} 位顾客，不随编号筛选改变。</p><div class="depth-duel">${panels}</div><p>同时属于这两个群体的顾客有 ${overlap} 位；两种方法的群体定义不同，不能把编号相同视为预测正确，也不能把归组不同视为模型改进。</p><details class="depth-calculation"><summary>查看规则的实际判断顺序</summary>${table(['判断条件','本顾客结果'],ruleTrace(person).map(x=>[x.condition,x.result]),'规则判断顺序')}<p>R 越小表示购买越近；“仅一次购买”只指当前 180 天窗口。90 天未购买规则优先于单次购买，群体名称不描述终身行为。</p></details><section class="segment-distance"><h3>与最近两个群中心的距离差</h3><p>最近为群 ${e.winner.group+1}，次近为群 ${e.runner.group+1}；平方距离分别为 ${num(e.winner.squared)} 与 ${num(e.runner.squared)}，差 ${num(e.gap)}。这是几何归组依据，不是置信度、未来消费概率或业务价值评分。</p><div class="segment-contributions" aria-label="三个特征对最近与次近中心距离差的贡献">${e.advantages.map((v,i)=>`<div><span>${axes[i]}</span><div class="segment-bar-track"><span style="width:${Math.max(...e.advantages.map(Math.abs))?Math.abs(v)/Math.max(...e.advantages.map(Math.abs))*100:0}%;background:${v>=0?'#087f9d':'#af8038'}"></span></div><strong>${signed(v)}</strong><small>${v>0?'更接近最近中心':v<0?'这一维更接近次近中心':'这一维距离相同'}</small></div>`).join('')}</div><p class="small-note">每维贡献 = 到次近中心的平方差 − 到最近中心的平方差，三项之和等于上述距离差。正负贡献均保留；这解释距离公式，不是因果归因或特征业务重要性。</p><details class="depth-calculation"><summary>查看标准化输入、各中心与逐维计算</summary>${table(['维度','原始输入','标准化 z','最近中心坐标','次近中心坐标','最近平方差','次近平方差','差值'],axes.map((label,i)=>[label,num(person.rfm[i]),num(e.z[i]),num(p.model.centers[e.winner.group][i]),num(p.model.centers[e.runner.group][i]),num(e.winner.parts[i]),num(e.runner.parts[i]),signed(e.advantages[i])]),'顾客距离逐维计算')}${table(['全部群中心','平方距离','欧氏距离'],e.centers.map(c=>[`群 ${c.group+1}`,num(c.squared),num(Math.sqrt(c.squared))]),'全部中心距离')}<p>z = (log1p(原值) − 初始样本中位数) ÷ 初始样本 IQR 尺度。两期复用相同变换与中心；各维同权计算，但已经变换，不能用原始英镑与天数直接相加。精确并列时沿用保存模型的最小编号中心；显示值四舍五入。</p></details></section><p><a href="#segments?${new URLSearchParams({case:'retail',view:'report',origin:snap.origin,method:'cluster',person:person.id})}">查看同范围群体交叉分布、稳定性与适用条件</a></p></section>`;
}
export function overlapView(p,snap){
 const c=overlapCounts(snap.rows);
 return `<section class="m5-section segment-overlap"><h2>同一批顾客在两种方法中的分布</h2><p>${esc(snap.origin)} 的全部 ${c.total} 位顾客，每位在表内只计一次。行是预设规则，列是模型群；单元格显示人数及该规则人群中的占比。</p>${table(['规则人群 → 模型群',...c.clusters.map((_,g)=>`群 ${g+1}`),'规则合计'],c.matrix.map((row,i)=>[esc(p.rule_names[i]),...row.map(n=>`${n} / ${pct(c.rules[i]?n/c.rules[i]:null)}`),c.rules[i]]).concat([['模型群合计',...c.clusters,c.total]]),'规则和模型群的全量交叉分布')}<p>这张表用于核查预设规则是否把不同消费组合放在一起，以及模型群是否混合了不同运营条件。两套划分没有“正确答案”标签，表格对角线不是准确率。是否需要细分，取决于运营行动能否做出区别并接受独立验证。</p></section>`;
}

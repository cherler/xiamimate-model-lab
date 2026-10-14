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
 return `<section class="m5-section segment-pair"><h2>同一顾客的规则与模型画像</h2><p>顾客 ${esc(person.id)} · ${esc(snap.origin)} 前 180 天。两侧使用同一份已发生交易，群画像来自本期全部 ${snap.rows.length} 位顾客，不随编号筛选改变。</p><div class="depth-duel">${panels}</div><p>同时属于这两个群体的顾客有 ${overlap} 位；两种方法的群体定义不同，不能把编号相同视为预测正确，也不能把归组不同视为模型改进。</p><details class="depth-calculation"><summary>查看规则的实际判断顺序</summary>${table(['判断条件','本顾客结果'],ruleTrace(person).map(x=>[x.condition,x.result]),'规则判断顺序')}<p>R 越小表示购买越近；“仅一次购买”只指当前 180 天窗口。90 天未购买规则优先于单次购买，群体名称不描述终身行为。</p></details><section class="segment-distance"><h3>与最近两个群中心的距离差</h3><p>最近为群 ${e.winner.group+1}，次近为群 ${e.runner.group+1}；平方距离分别为 ${num(e.winner.squared)} 与 ${num(e.runner.squared)}，差 ${num(e.gap)}。这是几何归组依据，不是置信度、未来消费概率或业务价值评分。</p><div class="segment-contributions" aria-label="三个特征对最近与次近中心距离差的贡献">${e.advantages.map((v,i)=>`<div><span>${axes[i]}</span><div class="segment-bar-track"><span style="width:${Math.max(...e.advantages.map(Math.abs))?Math.abs(v)/Math.max(...e.advantages.map(Math.abs))*100:0}%;background:${v>=0?'#087f9d':'#af8038'}"></span></div><strong>${signed(v)}</strong><small>${v>0?'更接近最近中心':v<0?'这一维更接近次近中心':'这一维距离相同'}</small></div>`).join('')}</div><p class="small-note">每维贡献 = 到次近中心的平方差 − 到最近中心的平方差，三项之和等于上述距离差。正负贡献均保留；这解释距离公式，不是因果归因或特征业务重要性。</p><details class="depth-calculation"><summary data-calculation="segments:retail">查看标准化输入、各中心与逐维计算</summary>${table(['维度','原始输入','标准化 z','最近中心坐标','次近中心坐标','最近平方差','次近平方差','差值'],axes.map((label,i)=>[label,num(person.rfm[i]),num(e.z[i]),num(p.model.centers[e.winner.group][i]),num(p.model.centers[e.runner.group][i]),num(e.winner.parts[i]),num(e.runner.parts[i]),signed(e.advantages[i])]),'顾客距离逐维计算')}${table(['全部群中心','平方距离','欧氏距离'],e.centers.map(c=>[`群 ${c.group+1}`,num(c.squared),num(Math.sqrt(c.squared))]),'全部中心距离')}<p>z = (log1p(原值) − 初始 log1p 特征中位数) ÷ 初始 log1p 特征 IQR 尺度。两期复用相同变换与中心；各维同权计算，但已经变换，不能用原始英镑与天数直接相加。精确并列时沿用保存模型的最小编号中心；显示值四舍五入。</p></details></section><p><a href="#segments?${new URLSearchParams({case:'retail',view:'report',origin:snap.origin,method:'cluster',person:person.id})}">查看同范围群体交叉分布、稳定性与适用条件</a></p></section>`;
}
export function overlapView(p,snap){
 const c=overlapCounts(snap.rows);
 return `<section class="m5-section segment-overlap"><h2>同一批顾客在两种方法中的分布</h2><p>${esc(snap.origin)} 的全部 ${c.total} 位顾客，每位在表内只计一次。行是预设规则，列是模型群；单元格显示人数及该规则人群中的占比。</p>${table(['规则人群 → 模型群',...c.clusters.map((_,g)=>`群 ${g+1}`),'规则合计'],c.matrix.map((row,i)=>[esc(p.rule_names[i]),...row.map(n=>`${n} / ${pct(c.rules[i]?n/c.rules[i]:null)}`),c.rules[i]]).concat([['模型群合计',...c.clusters,c.total]]),'规则和模型群的全量交叉分布')}<p>这张表用于核查预设规则是否把不同消费组合放在一起，以及模型群是否混合了不同运营条件。两套划分没有“正确答案”标签，表格对角线不是准确率。是否需要细分，取决于运营行动能否做出区别并接受独立验证。</p></section>`;
}

export function alignAssignments(baseline,assignments){
 if(baseline.length!==assignments.length||[...baseline,...assignments].some(v=>!Number.isInteger(v)||v<0||v>3))throw new Error('分群对齐样本无效');
 const counts=Array.from({length:4},()=>[0,0,0,0]);baseline.forEach((g,i)=>counts[g][assignments[i]]++);let score=-1,mapping=null,ties=0;
 const visit=(order,left)=>{if(!left.length){const n=order.reduce((sum,g,i)=>sum+counts[i][g],0);if(n>score){score=n;mapping=order;ties=1;}else if(n===score)ties++;return;}for(const g of left)visit([...order,g],left.filter(x=>x!==g));};visit([],[0,1,2,3]);
 const inverse=mapping.map((_,g)=>mapping.indexOf(g));return {mapping,inverse,ties,matched:score,aligned:assignments.map(g=>inverse[g])};
}
const stabilityCache=new WeakMap();
export function stabilityEvidence(p){
 if(stabilityCache.has(p))return stabilityCache.get(p);
 const first=p.snapshots[0],base=first.rows.map(r=>r.cluster),trials=p.stability.map(t=>({...alignAssignments(base,t.assignments),seed:t.seed}));
 const people=first.rows.map((row,i)=>({id:row.id,group:row.cluster,retained:trials.filter(t=>t.aligned[i]===row.cluster).length,index:i}));
 const result={trials,people};stabilityCache.set(p,result);return result;
}
export function temporalCustomer(p,id){
 const [a,b]=p.snapshots.map(s=>s.rows.find(r=>r.id===id)||null);
 if(!a&&!b)return null;
 return {id,a,b,status:!a?'entered':!b?'exited':'common',delta:a&&b?b.rfm.map((v,i)=>v-a.rfm[i]):null};
}
export function migrationCohorts(p,method){
 if(!['cluster','rule'].includes(method))throw new Error('未知分群方法');
 const [a,b]=p.snapshots.map(s=>new Map(s.rows.map(r=>[r.id,r]))),ids=[...new Set([...a.keys(),...b.keys()])].sort();
 return ids.map(id=>({id,kind:!a.has(id)?'entered':!b.has(id)?'exited':a.get(id)[method]===b.get(id)[method]?'same':'changed'}));
}
export function customerEvolution(p,id){
 const t=temporalCustomer(p,id);if(!t)return '<p role="status">该顾客不在两个保存时点的人群内。</p>';
 const evidence=stabilityEvidence(p),person=evidence.people.find(r=>r.id===id),pair=[t.a,t.b];
 return `<section class="m5-section segment-evolution"><h2>同一顾客的跨月变化与抽样稳定性</h2><p>顾客 ${esc(id)}，固定对照 ${p.snapshots[0].origin} → ${p.snapshots[1].origin}。此处不随上方单期画像范围改变。</p><div class="depth-duel"><section><p class="depth-role">变化来源：顾客历史窗口</p><h3>固定模型的跨月记录</h3>${table(['内容',...p.snapshots.map(x=>x.origin)],['R（天）','F（单）','M（£）','规则组','模型群'].map((label,i)=>[label,...pair.map(r=>!r?'未入本期人群':i<3?num(r.rfm[i]):esc(name(p,i===3?'rule':'cluster',r[i===3?'rule':'cluster'])))]),'同顾客两期画像')}<p>${t.delta?`R、F、M 净变化：${signed(t.delta[0])} 天、${signed(t.delta[1])} 单、£${signed(t.delta[2])}。规则${t.a.rule===t.b.rule?'保持同组':'发生换组'}，模型${t.a.cluster===t.b.cluster?'保持同群':'发生换群'}。`:(t.status==='entered'?'后一期进入 180 天有效购买人群，不等同于新注册或首次购买。':'后一期不在 180 天有效购买人群，不等同于永久流失。')}</p><p class="small-note">两期复用相同缩放和中心，群编号已固定，无需重新匹配；不能事后换编号掩盖迁移。订单与金额是滚动窗口净变化，不能仅靠差值拆出新订单和旧订单滑出。</p></section><section><p class="depth-role">变化来源：拟合样本</p><h3>初始顾客的 10 次抽样重拟合</h3>${person?`<p>使用 ${p.snapshots[0].origin} 的同一份 RFM，10 次已保存重拟合中，${person.retained} 次仍归到初始群 ${person.group+1} 对应的群体。</p><p>每次从初始 ${p.snapshots[0].rows.length} 位顾客抽取 ${p.stability[0].sample_n} 位重拟合，再给全部初始顾客分群；先按全体最大重合匹配编号，才统计该顾客。</p><details class="depth-calculation"><summary>查看该顾客每次重拟合的归组</summary>${table(['种子','原重拟合群号','对齐初始后的群号','是否保留初始归属'],evidence.trials.map((trial,i)=>[trial.seed,`原号 ${p.stability[i].assignments[person.index]+1}`,`群 ${trial.aligned[person.index]+1}`,trial.aligned[person.index]===person.group?'是':'否']),'顾客逐次重拟合归属')}<p>4 群遍历 24 种匹配，以全体重合人数最大为准；并列取字典序最小映射。原群号只是标识，对齐不读取后续购买。10 次保留次数不是置信概率。</p></details>`:'<p>该顾客不在初始拟合人群，未保存其 10 次重拟合归属。此项未评估，不借用他人或后一期结果代替。</p>'}<p class="small-note">重拟合稳定不代表以后不会换群；跨月换群也不等于训练不稳定。两类分析不能合成一个“分群准确率”。</p></section></div></section>`;
}
export function stabilitySummaryView(p){
 const e=stabilityEvidence(p),n=e.people.length,stable=e.people.filter(r=>r.retained===e.trials.length).length;
 return `<section class="m5-section segment-stability"><h2>重拟合稳定与跨月变化分别评价</h2><p>初始 ${n} 位顾客中，${stable} 位（${pct(stable/n)}）在 ${e.trials.length} 次重拟合中均保留对齐后的初始归属；其余 ${n-stable} 位至少有一次变化。覆盖全部初始顾客，不以高稳定样本替代全体。</p>${table(['初始模型群','初始人数','10 次都保留','至少一次变化','逐次保留率最低 / 最高'],[0,1,2,3].map(g=>{const rows=e.people.filter(r=>r.group===g),all=rows.filter(r=>r.retained===e.trials.length).length,rates=p.stability.map(t=>t.retention[g]);return [`群 ${g+1}`,rows.length,`${all} / ${pct(rows.length?all/rows.length:null)}`,rows.length-all,`${pct(Math.min(...rates))} / ${pct(Math.max(...rates))}`];}),'重拟合稳定性的全体顾客覆盖')}<p>重拟合先匹配群标签再比较，指标来自同一初始顾客与特征；下方跨月比较则固定模型、滚动 180 天历史，群编号沿用相同中心。两者回答不同问题，不互相替代。</p></section>`;
}
const migrationNames={all:'全部两期顾客',same:'共同顾客 · 同组',changed:'共同顾客 · 换组',entered:'仅后一期入群',exited:'仅初始一期入群'};
export function migrationExplorer(p,s){
 const all=migrationCohorts(p,s.method),rows=s.migration==='all'?all:all.filter(r=>r.kind===s.migration);let person=rows.find(r=>r.id===s.person)||rows[0];s.person=person?.id||'';
 const counts=Object.fromEntries(Object.keys(migrationNames).map(k=>[k,k==='all'?all.length:all.filter(r=>r.kind===k).length]));
 return `<section class="m5-section segment-migration"><h2>跨月迁移的顾客记录</h2><p>固定两期 ${p.snapshots.map(x=>x.origin).join(' → ')}，按${s.method==='cluster'?'固定 K-means':'固定 RFM 规则'}分类，共同同组 ${counts.same}、共同换组 ${counts.changed}、仅后一期 ${counts.entered}、仅初始一期 ${counts.exited}，合计 ${all.length} 位不同顾客。新增与离开不算入共同顾客迁移比例。</p><div class="lesson-controls"><label for="mon-migration">迁移人群<select id="mon-migration">${Object.entries(migrationNames).map(([key,label])=>`<option value="${key}" ${s.migration===key?'selected':''}>${label}（${counts[key]}）</option>`).join('')}</select></label>${rows.length?`<label for="mon-person">顾客记录（${rows.length} 位，按编号）<select id="mon-person">${rows.map(r=>`<option value="${esc(r.id)}" ${s.person===r.id?'selected':''}>${esc(r.id)} · ${migrationNames[r.kind]}</option>`).join('')}</select></label>`:'<p role="status">该方法没有此类顾客，其他分组记录仍保留。</p>'}</div>${person?customerEvolution(p,person.id):''}${person?`<p><a href="#segments?${new URLSearchParams({case:'retail',view:'experience',origin:p.snapshots.find(x=>x.origin===s.origin&&x.rows.some(r=>r.id===person.id))?.origin||p.snapshots.find(x=>x.rows.some(r=>r.id===person.id)).origin,method:s.method,person:person.id})}">查看该顾客所在时点的双方法画像</a></p>`:''}</section>`;
}
export function actionView(p,snap,method){
 return `<section class="m5-section segment-actions"><h2>群体特征对应的行动假设</h2><p>${snap.origin} · ${method==='cluster'?'K-means':'固定 RFM 规则'}。以下按各群当前 RFM 中位数提出讨论方向，尚未开展触达或干预；群内个体差异需要进一步核查，不直接决定个人待遇。</p>${table(['群体 / 样本','已观察画像（中位数）','可讨论的行动假设','实施前核查'],snap.profiles[method].map(g=>{const [r,f,m]=g.median_rfm||[];return [esc(name(p,method,g.group))+` / ${g.n} 人`,g.n?`${r} 天未买、${f} 单、£${num(m)}`:'空群，无画像',!g.n?'不生成行动假设':r>90?'讨论沉默人群的需求回访':f<=2?'讨论购买后的服务与二次购买需求':f>=5?'讨论补货提醒与服务优先级':'讨论不同购买周期的内容或商品匹配',!g.n?'需有足够样本':r>90?'季节采购与正常低频可能被误当流失':f<=2?'仅指当前窗口少单；核查批发与一次性采购':f>=5?'频繁或大额不等于高利润；需要退货和成本口径':'核查商品类别与周期，RFM 本身不含偏好信息'];}),'群体行动假设与前置核查')}<div class="depth-verdict"><strong>验证行动增益需要独立对照</strong><p>先固定目标、资格、时间窗与预算；在同类可触达人群中设置随机干预／保留对照，比较人均净收益、复购及退订等代价。样本量需按最小可接受效果和基准波动另行设计。本例没有干预分配、利润、许可或触达结果，不能给出营销提升。</p></div><p>当前可交付：可追溯的交易清洗、RFM 与规则／聚类、顾客归属、画像、稳定性和迁移报告。适用前提是稳定的顾客与订单标识、明确退货口径、足够的历史和可区分的运营方案；若群体无法对应不同动作，简单规则可能已经足够。后 30 天购买差异是观察性描述，不用于证明这些行动有效。</p></section>`;
}

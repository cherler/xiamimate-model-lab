import {DECISION_MODELS as MODELS,POLICIES,decisionInput,decisionMetrics,findPlan,aggregatePlans} from './decision-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'不适用':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const money=v=>`£${(v/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const pct=v=>v==null?'不适用':`${(100*v).toFixed(2)}%`;
const sum=a=>a.reduce((s,v)=>s+v,0);
const parts=['purchase','holding','shortage_cost','total_cost'];
const table=(heads,rows,label)=>`<div class="table-scroll decision-table" role="region" tabindex="0" aria-label="${esc(label)}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const select=(key,label,entries,value)=>`<label for="dec-${key}">${label}<select id="dec-${key}">${entries.map(([id,name])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
export function comparisonSides(s){
 const current={model:s.model,policy:s.policy};
 const reference=s.axis==='forecast'?{model:s.model==='lightgbm'?'four_week_mean':'lightgbm',policy:s.policy}:{model:s.model,policy:s.reference};
 return {current,reference};
}
export function itemCosts(w,plan,policy,cfg){
 const x=decisionInput(w.items,plan,cfg);
 return w.items.map((r,i)=>{const q=plan.policies[policy].packs[i],stock=r.initial+q*x.pack,purchase=q*x.pack*r.cost;
  const cost=d=>{const holding=Math.max(stock-d,0)*x.holding[i],shortage_cost=Math.max(d-stock,0)*x.penalty[i];return {purchase,holding,shortage_cost,total_cost:purchase+holding+shortage_cost};};
  const scenarios=x.demand[i].map(cost),observed=cost(r.actual),expected=Object.fromEntries(parts.map(k=>[k,sum(scenarios.map(c=>c[k]))/scenarios.length]));
  return {id:r.id,name:r.name,prediction:r.predictions[plan.model],actual:r.actual,packs:q,stock,observed,expected};
 });
}
export function pairedDecision(p,s){
 const sides=comparisonSides(s),windows=p.windows.map(w=>{
  const a=findPlan(w,{...s,model:sides.current.model}),b=findPlan(w,{...s,model:sides.reference.model});
  const current=itemCosts(w,a,sides.current.policy,p.protocol),reference=itemCosts(w,b,sides.reference.policy,p.protocol);
  const rows=current.map((v,i)=>({id:v.id,name:v.name,current:v,reference:reference[i],gain:Object.fromEntries(parts.map(k=>[k,reference[i].observed[k]-v.observed[k]]))}));
  return {origin:w.origin,current:a.policies[sides.current.policy],reference:b.policies[sides.reference.policy],rows,gain:sum(rows.map(r=>r.gain.total_cost))};
 });
 const totals=Object.fromEntries(Object.entries(sides).map(([key,v])=>{const a=aggregatePlans(p.windows.map(w=>findPlan(w,{...s,model:v.model})),v.policy);const errors=sum(windows.flatMap(w=>w.rows.map(r=>Math.abs(r[key].prediction-r[key].actual))));return [key,{...a,wape:a.demand_units?errors/a.demand_units:null}];}));
 return {sides,windows,totals,gain:totals.reference.total_cost-totals.current.total_cost,improved:windows.filter(w=>w.gain>.01).length,worse:windows.filter(w=>w.gain<-.01).length,tied:windows.filter(w=>Math.abs(w.gain)<=.01).length};
}
const label=v=>`${MODELS[v.model]} · ${POLICIES[v.policy]}`;
const gainText=v=>Math.abs(v)<=.01?'成本持平':`成本${v>0?'减少':'增加'} ${money(Math.abs(v))}`;
function controls(s){return `<div class="decision-controls decision-pair-controls">${select('axis','对照方式',[['strategy','固定预测，比较补货策略'],['forecast','固定策略，比较预测输入']],s.axis)}${select('policy','当前补货策略',Object.entries(POLICIES),s.policy)}${s.axis==='forecast'?`<p>对照预测<br><strong>${MODELS[comparisonSides(s).reference.model]}</strong><br>两侧使用相同补货策略</p>`:select('reference','对照补货策略',Object.entries(POLICIES),s.reference)}</div>`;}
function conditions(s){return `<p class="small-note">两侧固定同一商品、记录销量、初始库存、采购单价与整包大小；预算 ${num(s.budget)} 倍、库容 ${num(s.capacity)} 倍、缺货惩罚 ${num(s.shortage)} 倍。${s.axis==='forecast'?'更换预测会同时改变需求场景与订单，预期成本的场景分布不同，不能据此比较求解器优劣。预测贡献仅指这次固定策略的历史对照，不是因果收益。':'两侧需求场景相同；预期成本可比较同一目标，事后成本仍须单独验证。'}每个窗口库存重置，不能当成连续经营账本。</p>`;}
export function decisionPairView(p,s,report=false){
 const e=pairedDecision(p,s),w=e.windows.find(w=>w.origin===s.origin),rows=report?['reference','current'].map(key=>[label(e.sides[key]),money(e.totals[key].total_cost),money(e.totals[key].purchase),money(e.totals[key].holding),money(e.totals[key].shortage_cost),pct(e.totals[key].fill_rate)]):['reference','current'].map(key=>[label(e.sides[key]),money(w[key].observed.total_cost),money(w[key].observed.purchase),money(w[key].observed.holding),money(w[key].observed.shortage_cost),pct(w[key].observed.fill_rate)]);
 const link=(origin,view,item=s.item)=>`#decision?${new URLSearchParams({case:'retail',...s,origin,view,item})}`;
 const detail=report?table(['决策日期','对照成本','当前成本','对照 − 当前','查看订单'],e.windows.map(w=>[w.origin,money(w.reference.observed.total_cost),money(w.current.observed.total_cost),money(w.gain),`<a href="${esc(link(w.origin,'experience'))}">逐商品核算</a>`]),'固定单一变量的全部窗口对照'):`<h3>本窗口十二种商品的成本得失</h3><p>差值 = 对照 − 当前；正值表示当前成本更低。所有商品均保留，采购、持有、缺货三项差值可加总。</p>${table(['商品 / 编号','对照 → 当前预测','对照 → 当前包数','采购差','持有差','缺货惩罚差','总成本差'],w.rows.map(r=>[`<a href="${esc(link(s.origin,'experience',r.id))}">${esc(r.name)}</a><small>${esc(r.id)}</small>`,`${num(r.reference.prediction)} → ${num(r.current.prediction)}`,`${r.reference.packs} → ${r.current.packs}`,...parts.map(k=>`<span class="${r.gain[k]<-.01?'decision-loss':''}">${money(r.gain[k])}</span>`)]).concat([['合计','—','—',...parts.map(k=>money(sum(w.rows.map(r=>r.gain[k]))))]]),'逐商品成本增减')}`;
 return `<section class="decision-section decision-pair"><h2>预测与策略的贡献对照</h2><p>先固定一个环节，再看另一个环节如何改变订单和模拟成本。当前预测输入为 ${MODELS[s.model]}。</p>${controls(s)}${conditions(s)}<div class="depth-verdict"><strong>${report?'全部十二个窗口':s.origin+' 七日窗口'}：${gainText(report?e.gain:w.gain)}</strong><p>全窗口${gainText(e.gain)}；${e.improved} 窗改善、${e.worse} 窗退步、${e.tied} 窗持平。${e.sides.current.model===e.sides.reference.model&&e.sides.current.policy===e.sides.reference.policy?'当前与对照完全相同，不能据此判断增益。':''}</p></div>${table(['同条件方案','事后模拟成本','采购','持有','缺货惩罚','需求满足率'],rows,'单一变量成本对照')}${s.axis==='forecast'?`<p>全范围七日预测 WAPE：对照 ${pct(e.totals.reference.wape)} → 当前 ${pct(e.totals.current.wape)}；分母为全部 ${num(e.totals.current.demand_units)} 件记录销量。预测误差降低不保证补货成本降低；成本还取决于商品价格、缺货权重与资源分配。</p>`:''}<details class="depth-calculation"><summary>${report?'查看全部十二窗口的配对结果':'查看全部十二商品的订单变化与成本得失'}</summary>${detail}</details>${report?'':`<p><a href="${esc(link(s.origin,'report'))}">查看同条件全部十二个窗口与敏感性报告</a></p>`}<details class="depth-calculation"><summary>查看成本差的计算与证据范围</summary><p>每商品采购 = 包数 × 每包件数 × 采购单价；持有 = max(可供量 − 记录销量, 0) × 持有单价；缺货惩罚 = max(记录销量 − 可供量, 0) × 惩罚单价。先按未四舍五入的便士数求和，再显示英镑，小数显示可能出现尾差。持平容差为 0.01 便士。</p><p>复用冻结订单与原预测，未来销量只用于事后核算；全部是已知开发窗口，LightGBM 已在这些窗口比较参数。这里展示建模与核算能力，未证明未来收益或真实利润。</p></details></section>`;
}

// This is a local feasibility diagnostic of frozen orders, never a new order or solver.
export function packDiagnostics(w,plan,policy,cfg){
 const x=decisionInput(w.items,plan,cfg),packs=plan.policies[policy].packs,base=decisionMetrics(x,packs);
 return w.items.map((r,i)=>{const trial=[...packs];trial[i]++;const m=decisionMetrics(x,trial);
  return {id:r.id,name:r.name,extraCash:x.pack*x.cost[i],budgetBlocked:base.budget_slack+1e-6<x.pack*x.cost[i],capacityBlocked:base.capacity_slack<x.pack,feasible:m.feasible,expectedDelta:m.total_cost-base.total_cost};
 });
}
export function outcomeEvidence(p,s,report=false){
 const windows=report?p.windows:p.windows.filter(w=>w.origin===s.origin),plans=windows.map(w=>findPlan(w,s));
 const rows=windows.flatMap((w,i)=>{const plan=plans[i],x=decisionInput(w.items,plan,p.protocol);return itemCosts(w,plan,s.policy,p.protocol).map((r,j)=>({...r,origin:w.origin,low:Math.min(...x.demand[j]),high:Math.max(...x.demand[j]),delta:Object.fromEntries(parts.map(k=>[k,r.observed[k]-r.expected[k]]))}));});
 const expected=aggregatePlans(plans,s.policy,'expected'),observed=aggregatePlans(plans,s.policy);
 return {rows,expected,observed,delta:Object.fromEntries(parts.map(k=>[k,observed[k]-expected[k]])),below:rows.filter(r=>r.actual<r.low).length,above:rows.filter(r=>r.actual>r.high).length};
}
export function resourceComparisons(p,s){
 const w=p.windows.find(w=>w.origin===s.origin);
 return [['budget',p.protocol.budget_ratios],['capacity',p.protocol.capacity_ratios]].map(([key,values])=>({key,rows:values.map(v=>{const plan=findPlan(w,{...s,[key]:v}),r=plan.policies[s.policy];return {value:v,budget:plan.budget,capacity:plan.capacity,expected:r.expected,observed:r.observed};})}));
}
export function decisionOutcomeView(p,s,report=false){
 const e=outcomeEvidence(p,s,report),paired=pairedDecision(p,s),pw=paired.windows.find(w=>w.origin===s.origin),current=report?paired.windows:[pw];
 const targetGain=sum(current.map(w=>w.reference.expected.total_cost-w.current.expected.total_cost)),actualGain=sum(current.map(w=>w.gain));
 const byItem=table(['商品 / 编号','8 场景最小—最大','记录销量','记录位置','持有偏差','缺货惩罚偏差','总成本偏差'],e.rows.map(r=>[`${esc(r.name)}<small>${esc(r.id)}</small>`,`${num(r.low)}—${num(r.high)}`,num(r.actual),r.actual<r.low?'低于全部场景':r.actual>r.high?'高于全部场景':'在场景跨度内',money(r.delta.holding),money(r.delta.shortage_cost),money(r.delta.total_cost)]),'逐商品场景与事后偏差');
 const byWindow=table(['决策日期','当前策略场景预期','当前策略事后成本','事后 − 预期'],p.windows.map(w=>{const plan=findPlan(w,s).policies[s.policy];return [w.origin,money(plan.expected.total_cost),money(plan.observed.total_cost),money(plan.observed.total_cost-plan.expected.total_cost)];}),'逐窗口目标与事后差异');
 return `<section class="decision-section decision-diagnostics"><h2>场景目标与事后成本</h2><p>${report?'全部十二个独立窗口':s.origin+' 七日窗口'} · ${label({model:s.model,policy:s.policy})}。同一份冻结订单，左侧按事前 8 个需求场景计价，右侧按后续记录销量核算。</p><div class="depth-duel"><section><p class="depth-role">事前场景预期成本</p><h3>${money(e.expected.total_cost)}</h3><p>依据历史周块缩放需求；${s.policy==='milp'?'求解器最小化的目标。':'当前规则订单的场景成本，不是该规则直接求解的目标。'}</p></section><section><p class="depth-role">事后模拟成本</p><h3>${money(e.observed.total_cost)}</h3><p>采购、期末持有与缺货惩罚之和；使用记录销量，包含假设费用。</p></section></div><p>事后相对场景均值${e.delta.total_cost>=0?'高出':'低于'} ${money(Math.abs(e.delta.total_cost))}；采购不变，持有变化 ${money(e.delta.holding)}，缺货惩罚变化 ${money(e.delta.shortage_cost)}。</p>${s.axis==='strategy'?`<div class="depth-verdict"><strong>对照 ${POLICIES[s.reference]}：场景${gainText(targetGain)}，事后${gainText(actualGain)}</strong><p>${targetGain>.01&&actualGain<-.01?'目标改善在这批记录销量上发生反转。减少采购与预期成本，可能同时减少可供库存并增加实际模拟缺货。':'这两个差值分别回答目标是否改善、回放是否改善；结论只限所选条件与时间范围。'}不能用求解最优界差距替代业务验证。</p></div>`:'<p>当前对照更换了预测输入，两套预期成本使用不同需求场景；同条件收益判断以共同记录销量下的事后成本为准。</p>'}${table(['成本项','场景预期','事后模拟','事后 − 预期'],parts.map((k,i)=>[['采购','持有','缺货惩罚','总成本'][i],money(e.expected[k]),money(e.observed[k]),money(e.delta[k])]),'目标成本与实际模拟成本核算')}<p>${e.rows.length} 个商品窗口中，${e.above} 个记录销量高于全部 8 场景，${e.below} 个低于全部场景。场景最小至最大只描述这 8 个历史缩放值，不是预测区间，也没有覆盖率保证；在跨度内同样可能缺货。</p><details class="depth-calculation"><summary>${report?'查看十二窗口的目标偏差':'查看十二商品的需求偏离与成本偏差'}</summary>${report?byWindow:byItem}<p>事后偏差只作冻结订单的诊断，不用记录销量反推订单或重选默认策略。未知的缺货截断、商品替代等因素仍未被观测。</p></details></section>`;
}
export function decisionResourceView(p,s){
 const w=p.windows.find(w=>w.origin===s.origin),plan=findPlan(w,s),r=plan.policies[s.policy],d=packDiagnostics(w,plan,s.policy,p.protocol),blocked=d.filter(v=>!v.feasible).length,improving=d.filter(v=>v.feasible&&v.expectedDelta<-.01).length;
 const names={budget:'只改变预算',capacity:'只改变库容'};
 return `<section class="decision-section decision-diagnostics"><h2>资源约束与整包取舍</h2><p>${s.origin} · ${POLICIES[s.policy]}：预算余量 ${money(r.expected.budget_slack)}，库容余量 ${num(r.expected.capacity_slack)} 件。在其他订单不变时，${blocked} 种商品不能再加一包；${d.length-blocked} 种可以，其中 ${improving} 种能降低当前场景目标成本。</p><p>${blocked===0&&improving===0?'当前并非没有资源可用：继续加货不会降低这套场景目标。因此预算未用完本身不代表求解失败。':blocked===d.length?'现有方案已无法容纳任何商品的额外一包；这不代表所有资源恰好用尽，也不证明重新分配无法改善。':'不同商品的整包采购额不同，预算和库容可能限制可选订单；局部加包检查不等同于重新分配全部商品。'}</p><details class="depth-calculation"><summary>逐商品核验：保持其他订单不变，再加一包</summary>${table(['商品 / 编号','额外采购额','预算条件','库容条件','加包可行性','场景总成本变化'],d.map(v=>[`${esc(v.name)}<small>${esc(v.id)}</small>`,money(v.extraCash),v.budgetBlocked?'预算不足':'可容纳',v.capacityBlocked?'容量不足':'可容纳',v.feasible?'可行':'不可行',`${money(v.expectedDelta)}${v.feasible?'':'（忽略资源限制的核算）'}`]),'单包资源与目标成本诊断')}<p>每包 ${p.protocol.pack_size} 件；变化 = 加包后的场景总成本 − 原成本，负数为目标改善。只用于解释已保存方案，没有生成新订单。不可行变动不能直接执行；该诊断不是资源影子价格，也不能证明全局最优。</p></details><h3>单项资源变化的已保存结果</h3><p>保持 ${MODELS[s.model]}、${POLICIES[s.policy]} 和缺货惩罚 ${num(s.shortage)} 倍不变。每张表只改变一个资源额度，不能跨表归因。</p>${resourceComparisons(p,s).map(group=>`<h4>${names[group.key]}</h4>${table(['资源倍数','预算 / 库容','场景成本','事后成本','需求满足率','采购 / 剩余库容'],group.rows.map(v=>[`${num(v.value)} 倍${Number(s[group.key])===v.value?' · 当前':''}`,`${money(v.budget)} / ${num(v.capacity)} 件`,money(v.expected.total_cost),money(v.observed.total_cost),pct(v.observed.fill_rate),`${money(v.observed.purchase)} / ${num(v.expected.capacity_slack)} 件`]),names[group.key]+'的保存方案')}`).join('')}<p class="small-note">增加可用资源不强制多采购；规则策略也不保证场景目标单调改善。整数补货与需求估计会改变取舍，事后成本可能变差。不要从本次最优结果外推新增预算的未来回报。</p></section>`;
}
export function decisionApplicability(){
 return `<section class="case-story decision-diagnostics"><h2>本案例能支持的委托判断</h2><p>已展示：把需求预测转成受预算、库容和包装约束的订单；用相同条件拆分预测与策略贡献；定位成本变化的商品和费用来源。能否用于实际采购，还取决于以下业务条件。</p>${table(['业务条件','本案例证据与限制','定制时的验证重点'],[['多商品共享预算与库容','三策略资源相同，逐项校验整包与额度','接入真实库存、在途、采购价、包装与空间单位'],['缺货与积压代价可定义','仅用固定惩罚与持有系数；未计销售收入、残值','由业务确认服务目标与缺货代价，再比较同一目标'],['需求场景能代表后续波动','8 个历史缩放场景；缺货销量可能被截断','验证需求分布、季节与促销影响，不能只降预测平均误差'],['订单执行条件一致','期初立即到货，逐窗重置库存','补入提前期、供应能力、保质期并做连续库存仿真'],['收益可独立验证','已知开发回放，默认优化存在退步','预先固定验收期、成本和服务指标，再做前瞻或独立评估']],'补货优化适用条件与交付验证')}<p>当前结果不支持真实利润承诺；模型更复杂、求解达到最优，都不能替代上述验证。</p></section>`;
}

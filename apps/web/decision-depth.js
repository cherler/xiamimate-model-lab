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
 return `<section class="decision-section decision-pair"><h2>预测与策略的贡献对照</h2><p>先固定一个环节，再看另一个环节如何改变订单和模拟成本。当前预测输入为 ${MODELS[s.model]}。</p>${controls(s)}${conditions(s)}<div class="depth-verdict"><strong>${report?'全部十二个窗口':s.origin+' 七日窗口'}：${gainText(report?e.gain:w.gain)}</strong><p>全窗口${gainText(e.gain)}；${e.improved} 窗改善、${e.worse} 窗退步、${e.tied} 窗持平。${e.sides.current.model===e.sides.reference.model&&e.sides.current.policy===e.sides.reference.policy?'当前与对照完全相同，不能据此判断增益。':''}</p></div>${table(['同条件方案','事后模拟成本','采购','持有','缺货惩罚','需求满足率'],rows,'单一变量成本对照')}${s.axis==='forecast'?`<p>全范围七日预测 WAPE：对照 ${pct(e.totals.reference.wape)} → 当前 ${pct(e.totals.current.wape)}；分母为全部 ${num(e.totals.current.demand_units)} 件记录销量。预测误差降低不保证补货成本降低；成本还取决于商品价格、缺货权重与资源分配。</p>`:''}${detail}${report?'':`<p><a href="${esc(link(s.origin,'report'))}">查看同条件全部十二个窗口与敏感性报告</a></p>`}<details class="depth-calculation"><summary>查看成本差的计算与证据范围</summary><p>每商品采购 = 包数 × 每包件数 × 采购单价；持有 = max(可供量 − 记录销量, 0) × 持有单价；缺货惩罚 = max(记录销量 − 可供量, 0) × 惩罚单价。先按未四舍五入的便士数求和，再显示英镑，小数显示可能出现尾差。持平容差为 0.01 便士。</p><p>复用冻结订单与原预测，未来销量只用于事后核算；全部是已知开发窗口，LightGBM 已在这些窗口比较参数。这里展示建模与核算能力，未证明未来收益或真实利润。</p></details></section>`;
}

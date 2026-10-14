export const DECISION_MODELS={four_week_mean:'近四周周均预测',lightgbm:'LightGBM 七日预测'};
export const POLICIES={point:'按点预测补货',buffer:'预测＋安全库存',milp:'场景成本优化'};
const sum=a=>a.reduce((s,v)=>s+v,0);
const mean=a=>sum(a)/a.length;
export function decisionInput(items,plan,cfg){
 const demand=items.map(r=>{const m=mean(r.weeks);return r.weeks.map(w=>(m>0?w/m:1)*r.predictions[plan.model]);});
 const initial=items.map(r=>r.initial),cost=items.map(r=>r.cost),pack=cfg.pack_size;
 return {items,initial,cost,pack,demand,holding:cost.map(c=>c*cfg.holding_purchase_ratio),penalty:items.map(r=>r.price*plan.shortage_ratio),
  budget:Math.floor(plan.budget_ratio*sum(items.map(r=>r.cost*Math.max(mean(r.weeks)-r.initial,0)))),
  capacity:Math.max(sum(initial),Math.floor(plan.capacity_ratio*sum(items.map(r=>mean(r.weeks)))))};
}
export function decisionMetrics(x,packs,actual=null){
 const stock=packs.map((q,i)=>q*x.pack+x.initial[i]),demand=actual===null?x.demand:actual.map(v=>[v]),s=demand[0].length;
 let holding=0,shortageCost=0,shortage=0,leftover=0,totalDemand=0;
 for(let i=0;i<stock.length;i++)for(const d of demand[i]){const over=Math.max(stock[i]-d,0),under=Math.max(d-stock[i],0);holding+=over*x.holding[i]/s;shortageCost+=under*x.penalty[i]/s;shortage+=under/s;leftover+=over/s;totalDemand+=d/s;}
 const purchase=sum(packs.map((q,i)=>q*x.pack*x.cost[i])),stockUnits=sum(stock);
 return {purchase,holding,shortage_cost:shortageCost,total_cost:purchase+holding+shortageCost,shortage_units:shortage,leftover_units:leftover,demand_units:totalDemand,fill_rate:totalDemand?1-shortage/totalDemand:null,
  ordered_units:sum(packs)*x.pack,stock_units:stockUnits,budget_slack:x.budget-purchase,capacity_slack:x.capacity-stockUnits,
  feasible:packs.length===x.items.length&&packs.every(q=>Number.isInteger(q)&&q>=0)&&purchase<=x.budget+1e-6&&stockUnits<=x.capacity};
}
export function rulePacks(x,model,buffer=false){
 const wanted=x.items.map((r,i)=>{const m=mean(x.demand[i]),sd=Math.sqrt(mean(x.demand[i].map(v=>(v-m)**2)));return Math.ceil(Math.max(r.predictions[model]+(buffer?sd:0)-r.initial,0)/x.pack);});
 const spend=sum(wanted.map((q,i)=>q*x.pack*x.cost[i])),units=sum(wanted)*x.pack;
 const scale=Math.max(0,Math.min(1,spend?x.budget/spend:1,units?(x.capacity-sum(x.initial))/units:1)),q=wanted.map(v=>Math.floor(v*scale));
 let remaining=x.budget-sum(q.map((v,i)=>v*x.cost[i]*x.pack)),slots=x.capacity-sum(x.initial)-sum(q)*x.pack;
 while(slots>=x.pack){const possible=q.map((_,i)=>i).filter(i=>q[i]<wanted[i]&&x.cost[i]*x.pack<=remaining);if(!possible.length)break;
  possible.sort((i,j)=>(wanted[j]-q[j])-(wanted[i]-q[i])||x.items[i].id.localeCompare(x.items[j].id));const i=possible[0];q[i]++;remaining-=x.cost[i]*x.pack;slots-=x.pack;}
 return q;
}
export function findPlan(w,s){return w.plans.find(p=>p.model===s.model&&p.budget_ratio===Number(s.budget)&&p.capacity_ratio===Number(s.capacity)&&p.shortage_ratio===Number(s.shortage));}
export function aggregatePlans(plans,policy,kind='observed'){
 const rows=plans.map(p=>p.policies[policy][kind]),keys=['purchase','holding','shortage_cost','total_cost','shortage_units','leftover_units','demand_units','ordered_units'];
 const a=Object.fromEntries(keys.map(k=>[k,sum(rows.map(r=>r[k]))]));a.fill_rate=a.demand_units?1-a.shortage_units/a.demand_units:null;a.feasible=rows.every(r=>r.feasible);return a;
}
function near(a,b){if(a===null||b===null||typeof a==='boolean'||typeof b==='boolean'){if(a!==b)throw new Error('决策指标不一致');return;}if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>Math.max(1e-4,1e-8*Math.abs(a)))throw new Error('决策指标不一致');}
function compare(a,b){for(const k of Object.keys(a))near(a[k],b?.[k]);}
export function verifyDecision(p){
 const c=p.protocol;
 if(p.version!=='r6-v1'||c?.version!=='r6-v1'||!p.run_id?.startsWith('decision-')||!p.notice||p.windows?.length!==12||c.pack_size!==6||!c.forecast_models.every(m=>Object.hasOwn(DECISION_MODELS,m)))throw new Error('决策结果版本不一致');
 for(const k of ['protocol_sha256','frozen_sha256','inputs_sha256'])if(!/^[a-f0-9]{64}$/.test(p[k]))throw new Error('决策证据不完整');
 if(new Set(p.windows.map(w=>w.origin)).size!==12)throw new Error('决策窗口重复');
 const expected=new Set(c.forecast_models.flatMap(m=>c.budget_ratios.flatMap(b=>c.capacity_ratios.flatMap(k=>c.shortage_price_ratios.map(s=>[m,b,k,s].join('|'))))));
 for(const w of p.windows){
  if(w.items.length!==12||new Set(w.items.map(r=>r.id)).size!==12||w.plans.length!==expected.size)throw new Error('决策评估范围不完整');
  for(const r of w.items){
   if(r.weeks.length!==8||!r.weeks.every(v=>Number.isFinite(v)&&v>=0)||!Number.isFinite(r.actual)||r.actual<0||!Number.isFinite(r.price)||r.price<=0||!Number.isInteger(r.cost)||r.cost<=0||!Number.isInteger(r.initial)||r.initial<0)throw new Error('商品决策输入无效');
   near(r.initial,Math.floor(mean(r.weeks)*c.initial_stock_week_ratio));near(r.cost,Math.max(1,Math.ceil(r.price*c.purchase_price_ratio)));near(r.predictions.four_week_mean,mean(r.weeks.slice(-4)));
   for(const m of c.forecast_models)if(!Number.isFinite(r.predictions[m])||r.predictions[m]<0)throw new Error('预测无效');
  }
  const seen=new Set();
  for(const plan of w.plans){const key=[plan.model,plan.budget_ratio,plan.capacity_ratio,plan.shortage_ratio].join('|');if(!expected.has(key)||seen.has(key))throw new Error('决策组合不完整');seen.add(key);
   const x=decisionInput(w.items,plan,c);near(x.budget,plan.budget);near(x.capacity,plan.capacity);
   for(const method of Object.keys(POLICIES)){const r=plan.policies[method];if(!r||r.packs?.length!==w.items.length)throw new Error('补货方案缺失');const e=decisionMetrics(x,r.packs),o=decisionMetrics(x,r.packs,w.items.map(i=>i.actual));if(!e.feasible||!o.feasible)throw new Error('补货方案违反约束');compare(e,r.expected);compare(o,r.observed);
    if(method!=='milp'&&JSON.stringify(rulePacks(x,plan.model,method==='buffer'))!==JSON.stringify(r.packs))throw new Error('规则补货不一致');
   }
   const opt=plan.policies.milp;if(opt.status!==0||!Number.isFinite(opt.gap)||opt.gap<0||opt.gap>c.milp.mip_rel_gap+1e-8||!Number.isFinite(opt.dual_bound)||opt.dual_bound>opt.objective+.01)throw new Error('求解证据无效');near(opt.objective,opt.expected.total_cost);
   if(opt.objective-opt.dual_bound>Math.max(.01,Math.abs(opt.objective)*(c.milp.mip_rel_gap+1e-8)))throw new Error('最优界不一致');
   for(const m of ['point','buffer'])if(opt.objective>plan.policies[m].expected.total_cost+Math.max(.01,Math.abs(opt.objective)*c.milp.mip_rel_gap))throw new Error('优化目标劣于可行规则');
  }
 }
 return p;
}

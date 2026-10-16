import {decisionInput,decisionMetrics,findPlan} from './decision-metrics.js';
export const SERVICE_TARGETS=[.7,.8,.9];
const sum=a=>a.reduce((x,y)=>x+y,0);
const close=(a,b)=>typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-4,Math.abs(a)*1e-8);
export function serviceRows(p,parent,s){
 return p.records.filter(r=>r.model===s.model&&r.budget===Number(s.budget)&&r.capacity===Number(s.capacity)).map(r=>{
  const w=parent.windows.find(w=>w.origin===r.origin),plan=findPlan(w,{...s,shortage:1.5});
  return {r,w,plan,result:r.services.find(z=>z.target===Number(s.service)),audit:p.audit.rows.find(z=>z.origin===r.origin&&z.model===r.model)};
 });
}
export function serviceSummary(rows,target){
 const valid=rows.filter(r=>r.result.status===0),eligible=valid.filter(r=>r.plan.policies.point.expected.fill_rate>=target-1e-8);
 const fill=(list,fn)=>{const d=sum(list.map(r=>fn(r).demand_units));return d?1-sum(list.map(r=>fn(r).shortage_units))/d:null;};
 const wins=list=>list.filter(r=>r.result.observed.total_cost<r.plan.policies.point.observed.total_cost-.01).length;
 const losses=list=>list.filter(r=>r.result.observed.total_cost>r.plan.policies.point.observed.total_cost+.01).length;
 return {total:rows.length,valid:valid.length,infeasible:rows.filter(r=>r.result.status===2).length,unknown:rows.filter(r=>![0,2].includes(r.result.status)).length,
  wins:wins(valid),losses:losses(valid),ties:valid.length-wins(valid)-losses(valid),eligible:eligible.length,eligible_wins:wins(eligible),eligible_losses:losses(eligible),actual_meet:valid.filter(r=>r.result.observed.fill_rate!=null&&r.result.observed.fill_rate>=target-1e-8).length,
  extra_expected:valid.length?sum(valid.map(r=>r.result.expected.total_cost-r.plan.policies.milp.expected.total_cost)):null,
  actual_delta:valid.length?sum(valid.map(r=>r.result.observed.total_cost-r.plan.policies.point.observed.total_cost)):null,
  eligible_actual_delta:eligible.length?sum(eligible.map(r=>r.result.observed.total_cost-r.plan.policies.point.observed.total_cost)):null,
  fill:fill(valid,r=>r.result.observed),point_fill:fill(valid,r=>r.plan.policies.point.observed)};
}
export function verifyService(p,parent,spec){
 const fail=s=>{throw new Error('服务约束证据校验失败：'+s);};
 const c=p?.protocol;
 if(p?.schema!=='decision-service-v1'||p.parent_run!==parent.run_id||p.parent_sha256!==spec.sha256||c?.schema!=='decision-service-protocol-v1'||c.parent_run!==parent.run_id||c.parent_sha256!==spec.sha256||c.parent_inputs_sha256!==parent.inputs_sha256||c.source_code_sha256!==parent.code_sha256['core.py']||c.shortage_ratio!==1.5||JSON.stringify(c.targets)!==JSON.stringify(SERVICE_TARGETS)||c.default_target!==.8)fail('父版本或协议');
 for(const [a,b] of [[c.origins,parent.windows.map(w=>w.origin)],[c.models,parent.protocol.forecast_models],[c.budget_ratios,parent.protocol.budget_ratios],[c.capacity_ratios,parent.protocol.capacity_ratios]])if(JSON.stringify(a)!==JSON.stringify(b))fail('评估范围');
 if(p.records?.length!==144||c.expected_configurations!==144||c.expected_service_results!==432||p.audit?.parent_sha256!==spec.sha256||p.audit.rows?.length!==24)fail('完整性');
 const compare=(got,saved)=>{for(const [k,v] of Object.entries(got))if(v===null||typeof v==='boolean'?v!==saved?.[k]:!close(v,saved?.[k]))fail('成本或服务指标');};
 const seen=new Set();
 for(const r of p.records){
  const key=[r.origin,r.model,r.budget,r.capacity].join('|');
  if(seen.has(key)||!c.origins.includes(r.origin)||!c.models.includes(r.model)||!c.budget_ratios.includes(r.budget)||!c.capacity_ratios.includes(r.capacity)||JSON.stringify(r.services?.map(v=>v.target))!==JSON.stringify(SERVICE_TARGETS))fail('重复或缺失组合');seen.add(key);
  const w=parent.windows.find(w=>w.origin===r.origin),plan=findPlan(w,{model:r.model,budget:r.budget,capacity:r.capacity,shortage:1.5}),x=decisionInput(w.items,plan,parent.protocol);
  for(const z of [r.ceiling,...r.services]){
   if(![0,1,2,3,4].includes(z?.status)||!Number.isFinite(z.seconds)||z.seconds<0)fail('求解状态');
   if(z.status!==0){if(z.packs!==null||z.expected!==null||z.observed!=null)fail('无解伪装订单');continue;}
   if(z.packs?.length!==12)fail('订单范围');
   const e=decisionMetrics(x,z.packs);if(!e.feasible)fail('资源或整包约束');compare(e,z.expected);
   const objective=z===r.ceiling?e.shortage_units:e.total_cost;
   if(!close(objective,z.objective)||!Number.isFinite(z.dual_bound)||!Number.isFinite(z.gap)||z.gap<0||z.gap>1.01e-6||z.dual_bound>objective+.01||objective-z.dual_bound>Math.max(.01,Math.abs(objective)*1.01e-6))fail('最优界');
   if(z===r.ceiling)continue;
   if(e.fill_rate!=null&&e.fill_rate<z.target-1e-8)fail('服务未达标');compare(decisionMetrics(x,z.packs,w.items.map(i=>i.actual)),z.observed);
   const tol=Math.max(.1,Math.abs(objective)*2e-6);
   if(objective<plan.policies.milp.expected.total_cost-tol)fail('约束代价');
   for(const base of Object.values(plan.policies))if(base.expected.fill_rate>=z.target-1e-8&&objective>base.expected.total_cost+tol)fail('劣于同服务可行规则');
  }
  if(r.ceiling.status===0){const d=r.ceiling.expected.demand_units,upper=d?1-Math.max(0,r.ceiling.dual_bound)/d:null;
   for(const z of r.services){if(z.status===0&&d&&z.expected.fill_rate>upper+1e-8)fail('超过可达上界');if(z.status===2&&d&&r.ceiling.expected.fill_rate>=z.target+1e-8)fail('不可行与证据冲突');}
  }
 }
 return p;
}

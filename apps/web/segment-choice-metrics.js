export const CHOICE_METHODS=['rfm','kmeans','leiden','matched','hdbscan'];
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const demand=(v,message)=>{if(!v)throw Error(message);};
const choose2=n=>n*(n-1)/2;
export function partitionARI(a,b){
 demand(a.length===b.length,'稳定性人群不一致');if(a.length<2)return null;
 const cells=new Map(),left=new Map(),right=new Map();a.forEach((x,i)=>{const y=b[i],key=JSON.stringify([x,y]);cells.set(key,(cells.get(key)||0)+1);left.set(x,(left.get(x)||0)+1);right.set(y,(right.get(y)||0)+1);});
 const sum=x=>[...x.values()].reduce((s,n)=>s+choose2(n),0),l=sum(left),r=sum(right),expected=l*r/choose2(a.length),max=(l+r)/2;return max===expected?1:(sum(cells)-expected)/(max-expected);
}
export function pairedChoice(records){
 const n=records.length;demand(new Set(records.map(r=>r.id)).size===n,'配对顾客重复');let wins=0,losses=0,ties=0;
 for(const r of records){demand(Number.isInteger(r.targets)&&r.targets>0&&[r.model_hits,r.baseline_hits].every(x=>Number.isInteger(x)&&x>=0&&x<=r.targets),'配对命中无效');if(r.model_hits>r.baseline_hits)wins++;else if(r.model_hits<r.baseline_hits)losses++;else ties++;}
 const model=mean(records.map(r=>r.model_hits/r.targets)),baseline=mean(records.map(r=>r.baseline_hits/r.targets));
 return {n,model,baseline,delta:n?model-baseline:null,wins,losses,ties,ids:records.map(r=>r.id)};
}
export function conditionFlags(row,protocol){
 const [d1,d2]=row.kmeans_distances,margin=d2>0?(d2-d1)/d2:0;
 return {single_invoice:row.rfm[1]<=protocol.conditions.single_invoice_max,low_catalog:row.total_items>0&&row.catalog_items/row.total_items<protocol.conditions.low_catalog_share_below,near_kmeans:margin<=protocol.conditions.near_kmeans_relative_margin_max};
}
function sourceMaps(w){
 const ids=new Set(w.rows.map(r=>r.id)),labels=new Map(w.rows.map(r=>[r.id,r.labels])),all=new Map(w.future.rfm.rows.map(r=>[r.id,r]));
 demand(all.size===w.future.rfm.returning&&w.rows.every(r=>r.labels.rfm>=0),'完整回访人群缺失');
 const maps=Object.fromEntries(CHOICE_METHODS.map(m=>[m,new Map(w.future[m].rows.map(r=>[r.id,r]))]));
 for(const m of CHOICE_METHODS){const map=maps[m];demand(map.size===w.future[m].rows.length,'重复回访样本');
  for(const [id,r] of map){const ref=all.get(id);demand(ids.has(id)&&ref&&r.targets===ref.targets&&r.global_hits===ref.global_hits&&r.group===labels.get(id)[m]&&r.group>=0,'同顾客后续分母或热门参照不一致');}
  for(const [id] of all)demand(map.has(id)===(labels.get(id)[m]>=0),'已归群回访记录不完整');
 }
 return {all,maps};
}
export function buildChoiceWindow(w,protocol){
 const {all,maps}=sourceMaps(w),byId=new Map(w.rows.map(r=>[r.id,r]));
 const comparisons=Object.fromEntries(protocol.comparisons.map(c=>{const rows=[...all.keys()].filter(id=>maps[c.model].has(id)&&maps[c.baseline].has(id)).map(id=>({id,targets:all.get(id).targets,model_hits:maps[c.model].get(id).group_hits,baseline_hits:maps[c.baseline].get(id).group_hits}));return [c.id,pairedChoice(rows)];}));
 const features=[...all.keys()].map(id=>({id,targets:all.get(id).targets,model_hits:maps.kmeans.get(id).group_hits,baseline_hits:maps.rfm.get(id).group_hits}));
 const cohorts=Object.fromEntries(['single_invoice','low_catalog','near_kmeans'].map(flag=>{const members=w.rows.filter(r=>conditionFlags(r,protocol)[flag]),set=new Set(members.map(r=>r.id));return [flag,{historical:members.length,unassigned:members.filter(r=>r.labels.hdbscan<0).length,paired:pairedChoice(features.filter(r=>set.has(r.id)))}];}));
 const tiers=[0,1,2,3].map(tier=>{const members=w.rows.filter(r=>r.labels.rfm===tier),set=new Set(members.map(r=>r.id));return {tier,historical:members.length,preference_groups:new Set(members.map(r=>r.labels.kmeans)).size,leiden_groups:new Set(members.map(r=>r.labels.leiden)).size,unassigned:members.filter(r=>r.labels.hdbscan<0).length,paired:pairedChoice(features.filter(r=>set.has(r.id)))};});
 const coverage=Object.fromEntries(CHOICE_METHODS.map(m=>[m,{historical:w.rows.filter(r=>r.labels[m]>=0).length,excluded:w.excluded_ids.length,unassigned:w.rows.filter(r=>r.labels[m]<0).length,returning:all.size,evaluated:maps[m].size,not_returning:w.rows.length-all.size,conditional_mean:mean([...maps[m].values()].map(r=>r.group_hits/r.targets))}]));
 const fallbackRows=[...all.values()].map(r=>({id:r.id,targets:r.targets,model_hits:maps.hdbscan.get(r.id)?.group_hits??r.global_hits,baseline_hits:r.global_hits}));
 const fallback={group_used:maps.hdbscan.size,global_used:all.size-maps.hdbscan.size,vs_global:pairedChoice(fallbackRows),vs_kmeans:pairedChoice(fallbackRows.map(r=>({...r,baseline_hits:maps.kmeans.get(r.id).group_hits}))),group_only:pairedChoice([...maps.hdbscan.values()].map(r=>({id:r.id,targets:r.targets,model_hits:r.group_hits,baseline_hits:r.global_hits})))};
 return {origin:w.origin,all_customers:w.all_customers,eligible:w.rows.length,excluded:w.excluded_ids.length,returning:all.size,not_returning:w.rows.length-all.size,comparisons,tiers,cohorts,coverage,fallback};
}
function stability(p){
 return Object.fromEntries(CHOICE_METHODS.map(m=>{
  const samples=p.stability.subsamples.filter(s=>s.method===m).map(s=>{demand(s.indices.length===s.labels.length&&new Set(s.indices).size===s.indices.length,'抽样记录无效');const ref=s.indices.map(i=>{demand(Number.isInteger(i)&&i>=0&&i<p.windows[0].rows.length,'抽样索引无效');return p.windows[0].rows[i].labels[m];}),joint=ref.flatMap((x,i)=>x>=0&&s.labels[i]>=0?[i]:[]),ari=partitionARI(ref,s.labels),assigned=partitionARI(joint.map(i=>ref[i]),joint.map(i=>s.labels[i]));
   demand(Math.abs(ari-s.ari_all)<1e-10&&((assigned===null&&s.ari_assigned===null)||Math.abs(assigned-s.ari_assigned)<1e-10),'抽样稳定性与保存划分不一致');return {seed:s.seed,n:ref.length,joint:joint.length,ari_all:ari,ari_assigned:assigned};});return [m,{origin:p.windows[0].origin,available:!!samples.length,samples}];
 }));
}
export function buildChoiceStudy(p,protocol){
 demand(protocol.schema==='segment-choice-protocol-v1'&&p.run_id===protocol.parent_run,'分群选择协议不一致');demand(JSON.stringify(p.windows.map(w=>w.origin))===JSON.stringify(protocol.origins),'观察范围不一致');
 const first=new Set(p.windows[0].rows.map(r=>r.id)),second=p.windows[1],entered=second.rows.filter(r=>!first.has(r.id));
 return {windows:p.windows.map(w=>buildChoiceWindow(w,protocol)),stability:stability(p),newcomers:{origin:second.origin,new_to_snapshot:entered.length,ids:entered.map(r=>r.id),no_catalog:p.windows.map(w=>({origin:w.origin,count:w.excluded_ids.length})),assigned:Object.fromEntries(CHOICE_METHODS.map(m=>[m,entered.filter(r=>r.labels[m]>=0).length])),frozen_assignment_validated:false,no_history_validated:false}};
}
export function equalChoice(a,b){
 if(typeof a==='number'&&typeof b==='number'){demand(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a)),'分群选择统计不一致');return;}
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){demand(a===b,'分群选择内容不一致');return;}
 demand(JSON.stringify(Object.keys(a).sort())===JSON.stringify(Object.keys(b).sort()),'分群选择字段不一致');for(const k of Object.keys(a))equalChoice(a[k],b[k]);
}
export function verifyChoice(p,parent,manifest){
 demand(p.schema==='segment-choice-v1'&&p.parent_sha256===manifest.sha256&&p.protocol.parent_sha256===manifest.sha256&&p.parent_run===parent.run_id&&p.notice===parent.notice,'分群选择来源不一致');equalChoice(p.result,buildChoiceStudy(parent,p.protocol));return p;
}

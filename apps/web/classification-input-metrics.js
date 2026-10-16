import {applyPolicy,confusionCounts,scoreMetrics} from './classification-metrics.js';
export const INPUT_VARIANTS={all:'全部输入',words_only:'仅词频',no_words:'移除词频',no_characters:'移除特殊字符频率',no_capitals:'移除大写统计'};
export const INPUT_MODELS={logistic:'逻辑回归',lightgbm:'LightGBM'};
export const inputKey=(variant,model)=>`${variant}:${model}`;
export function inputSelected(rows,key,share){
 return applyPolicy(rows.map(r=>({...r,scores:{lightgbm:r.scores[key]}})),'lightgbm',{mode:'capacity',share});
}
export function inputPair(rows,a,b,share){
 const aa=inputSelected(rows,a,share),bb=inputSelected(rows,b,share),changes={corrected_fn:[],new_fn:[],corrected_fp:[],new_fp:[]};
 for(const r of rows)if(aa.has(r.id)!==bb.has(r.id)){
  const kind=r.label?(aa.has(r.id)?'corrected_fn':'new_fn'):(aa.has(r.id)?'new_fp':'corrected_fp');changes[kind].push(r.id);
 }
 return {a:confusionCounts(rows,aa),b:confusionCounts(rows,bb),changes};
}
export function equalInputs(a,b){
 if(typeof a==='number'){if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1e-9)throw Error('输入价值指标复算失败');return;}
 if(a&&typeof a==='object'){
  if(!b||Array.isArray(a)!==Array.isArray(b)||Object.keys(a).sort().join('|')!==Object.keys(b).sort().join('|'))throw Error('输入价值结构不一致');
  for(const k of Object.keys(a))equalInputs(a[k],b[k]);return;
 }
 if(a!==b)throw Error('输入价值记录不一致');
}
export function verifyInputs(p,parent=null){
 if(p?.schema!=='spambase-input-value-v1'||p.parent_run!=='spambase-20261013T233632651140Z'||!p.run_id?.startsWith('classification-input-')||p.access?.test_opened!==false||p.rows?.length!==429||!p.notice?.includes('CC BY 4.0'))throw Error('输入价值版本或评估范围无效');
 equalInputs(p.access.partitions,['train','calibration','validation']);
 equalInputs(Object.keys(p.protocol.variants),Object.keys(INPUT_VARIANTS));equalInputs(p.protocol.models,Object.keys(INPUT_MODELS));equalInputs(p.protocol.capacity_shares,[.1,.2,.3]);
 const keys=Object.keys(INPUT_VARIANTS).flatMap(v=>Object.keys(INPUT_MODELS).map(m=>inputKey(v,m))),ids=new Set();
 const originals=parent?new Map(parent.rows.validation.map(r=>[r.id,r])):null;
 if(parent&&parent.run_id!==p.parent_run)throw Error('输入价值父版本不一致');
 for(const r of p.rows){
  if(![0,1].includes(r.label)||!/^[a-f0-9]{64}$/.test(r.group)||!Number.isInteger(r.source_row)||r.source_row<1||r.id!==`mail-${String(r.source_row).padStart(5,'0')}`||ids.has(r.id))throw Error('输入价值验证记录无效');ids.add(r.id);
  if(originals){const row=originals.get(r.id);if(!row||row.group!==r.group||row.label!==r.label||row.source_row!==r.source_row)throw Error('输入价值原分区归属不一致');}
  for(const source of ['raw_scores','scores']){equalInputs(Object.keys(r[source]).sort(),[...keys].sort());for(const k of keys)if(!Number.isFinite(r[source][k])||r[source][k]<0||r[source][k]>1)throw Error('输入价值分数无效');}
 }
 equalInputs(Object.keys(p.result.models).sort(),[...keys].sort());equalInputs(Object.keys(p.thresholds).sort(),[...keys].sort());
 for(const k of keys){
  const result=p.result.models[k];
  if(!Number.isFinite(p.thresholds[k])||p.thresholds[k]<0||p.thresholds[k]>1.000001)throw Error('输入价值阈值无效');equalInputs(result.threshold,p.thresholds[k]);
  for(const [target,source] of [['raw','raw_scores'],['calibrated','scores']]){const {pr,...m}=scoreMetrics(p.rows,k,source);equalInputs(m,result[target]);}
  equalInputs(result.policy,confusionCounts(p.rows,new Set(p.rows.filter(r=>r.scores[k]>=p.thresholds[k]).map(r=>r.id))));
  equalInputs(Object.keys(result.capacity),['0.1','0.2','0.3']);
  for(const s of p.protocol.capacity_shares)equalInputs(result.capacity[s],confusionCounts(p.rows,inputSelected(p.rows,k,s)));
 }
 const contrasts=Object.keys(INPUT_MODELS).flatMap(m=>Object.keys(INPUT_VARIANTS).filter(v=>v!=='all').map(v=>[inputKey('all',m),inputKey(v,m)]));
 contrasts.push(...Object.keys(INPUT_VARIANTS).map(v=>[inputKey(v,'lightgbm'),inputKey(v,'logistic')]));
 equalInputs(p.result.pairs.map(x=>[x.a,x.b]),contrasts);
 for(const pair of p.result.pairs){
  equalInputs(pair.ap_gain,p.result.models[pair.a].calibrated.ap-p.result.models[pair.b].calibrated.ap);
  equalInputs(pair.brier_reduction,p.result.models[pair.b].calibrated.brier-p.result.models[pair.a].calibrated.brier);
  for(const s of p.protocol.capacity_shares)equalInputs(pair.capacity[s],Object.fromEntries(Object.entries(inputPair(p.rows,pair.a,pair.b,s).changes).map(([k,v])=>[k,v.length])));
  for(const metric of ['ap_gain','brier_reduction']){const range=pair.intervals[metric];if(range?.length!==2||!range.every(Number.isFinite)||range[0]>range[1])throw Error('输入价值重采样范围无效');}
  if(pair.intervals.valid_resamples!==p.protocol.uncertainty.repeats)throw Error('输入价值重采样次数不一致');
 }
 return p;
}

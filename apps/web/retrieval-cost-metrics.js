import {retrievalMetrics,percentile} from './retrieval-metrics.js';
export const COST_METHODS={bm25:'BM25 关键词',hybrid:'混合召回',colbert50:'混合前 50＋ColBERT',colbert100:'混合前 100＋ColBERT',colbert_full:'全库精确 ColBERT'};
export const COST_PAIRS={rerank:{a:'colbert50',b:'hybrid',label:'同候选增加重排'},expand:{a:'colbert100',b:'colbert50',label:'重排候选从 50 扩至 100'},full:{a:'colbert_full',b:'colbert100',label:'前 100 候选改为全库扫描'},full50:{a:'colbert_full',b:'colbert50',label:'前 50 候选改为全库扫描'}};
export function equalCost(a,b){
 if(typeof a==='number'){if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1e-8)throw Error('检索成本数值不一致');return;}
 if(a&&typeof a==='object'){if(!b||Array.isArray(a)!==Array.isArray(b)||Object.keys(a).sort().join('|')!==Object.keys(b).sort().join('|'))throw Error('检索成本结构不一致');for(const k of Object.keys(a))equalCost(a[k],b[k]);return;}
 if(a!==b)throw Error('检索成本记录不一致');
}
export function metricsCost(rank,rel){const m=retrievalMetrics(rank,rel);return {ndcg_at_10:m.ndcg,recall_at_10:m.recall,mrr_at_10:m.mrr,recall_at_50:retrievalMetrics(rank,rel,50).recall,recall_at_100:retrievalMetrics(rank,rel,100).recall};}
export function compareCost(rows,a,b){
 let wins=0,losses=0,ties=0,delta=0,gained=0,lost=0;
 for(const r of rows){const d=r.metrics[a].ndcg_at_10-r.metrics[b].ndcg_at_10;delta+=d;if(d>1e-12)wins++;else if(d< -1e-12)losses++;else ties++;
  for(const id of Object.keys(r.relevant)){const aa=r.rankings[a].slice(0,10).includes(id),bb=r.rankings[b].slice(0,10).includes(id);if(aa&&!bb)gained++;if(bb&&!aa)lost++;}
 }
 return {delta:delta/rows.length,wins,losses,ties,gained_targets10:gained,lost_targets10:lost};
}
export function selectCost(p,params){
 const pair=Object.hasOwn(COST_PAIRS,params.get('costPair'))?params.get('costPair'):'expand',c=COST_PAIRS[pair];
 const filter=['all','outside','better','worse'].includes(params.get('costFilter'))?params.get('costFilter'):'all';
 const rows=p.rows.filter(r=>{const d=r.metrics[c.a].ndcg_at_10-r.metrics[c.b].ndcg_at_10;return filter==='all'||(filter==='outside'?r.outside50.length:filter==='better'?d>1e-12:d< -1e-12);});
 return {pair,filter,rows,row:rows.find(r=>r.id===params.get('costQuery'))||rows[0],comparison:p.summary.comparisons.find(x=>x.a===c.a&&x.b===c.b)};
}
export function verifyCost(p,parent){
 if(p?.schema!=='scifact-end-to-end-v1'||p.rows?.length!==300||p.costs?.documents!==5183||p.protocol?.parent_run!==parent.run_id||!p.notice?.includes('CC BY-SA'))throw Error('检索成本范围或来源无效');
 equalCost(p.protocol.methods,Object.keys(COST_METHODS));equalCost(p.rows.map(r=>r.id),parent.queries.map(q=>q.id));
 const byId=new Map(parent.queries.map(q=>[q.id,q])),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
 for(const r of p.rows){
  const old=byId.get(r.id);equalCost(r.relevant,old.relevant);equalCost(r.text,old.text);
  equalCost(Object.keys(r.rankings).sort(),Object.keys(COST_METHODS).sort());
  equalCost(r.outside50,Object.keys(r.relevant).filter(id=>!r.rankings.hybrid.slice(0,50).includes(id)));
  for(const m of Object.keys(COST_METHODS)){
   const rank=r.rankings[m];if(rank.length!==100||new Set(rank).size!==100||rank.some(id=>!Object.hasOwn(parent.documents,id)))throw Error('检索成本排名范围错误');
   equalCost(r.metrics[m],metricsCost(rank,r.relevant));
   const t=r.timing[m],values=Object.values(t.components_ms);if(![t.total_ms,...values].every(v=>Number.isFinite(v)&&v>=0)||t.total_ms+1e-8<values.reduce((s,v)=>s+v,0))throw Error('完整流水线计时无效');
  }
  equalCost([...r.rankings.colbert50.slice(0,50)].sort(),[...r.rankings.hybrid.slice(0,50)].sort());equalCost(r.rankings.colbert50.slice(50),r.rankings.hybrid.slice(50));
  equalCost([...r.rankings.colbert100].sort(),[...r.rankings.hybrid].sort());
 }
 for(const m of Object.keys(COST_METHODS)){
  for(const k of Object.keys(p.rows[0].metrics[m]))equalCost(p.summary.metrics[m][k],mean(p.rows.map(r=>r.metrics[m][k])));
  equalCost(p.summary.timing[m].p50_ms,percentile(p.rows.map(r=>r.timing[m].total_ms),.5));equalCost(p.summary.timing[m].p95_ms,percentile(p.rows.map(r=>r.timing[m].total_ms),.95));
  const components=[...new Set(p.rows.flatMap(r=>Object.keys(r.timing[m].components_ms)))].sort();
  equalCost(p.summary.timing[m].components_mean_ms,Object.fromEntries(components.map(k=>[k,mean(p.rows.map(r=>r.timing[m].components_ms[k]||0))])));
  equalCost(p.summary.outside50[m],{found10:p.rows.reduce((n,r)=>n+r.outside50.filter(d=>r.rankings[m].slice(0,10).includes(d)).length,0),found100:p.rows.reduce((n,r)=>n+r.outside50.filter(d=>r.rankings[m].includes(d)).length,0)});
 }
 equalCost(p.summary.comparisons.map(c=>[c.a,c.b]),Object.values(COST_PAIRS).map(c=>[c.a,c.b]));
 for(const c of p.summary.comparisons){const {a,b,ci95,...rest}=c;equalCost(rest,compareCost(p.rows,a,b));if(ci95?.length!==2||!ci95.every(Number.isFinite)||ci95[0]>ci95[1])throw Error('配对范围无效');}
 if(p.audit_summary.documents!==5183||p.audit_summary.queries!==300||p.audit_summary.chunks!==p.costs.chunks)throw Error('文本审计范围不一致');
 equalCost(p.audit_summary.targets_missing50,p.rows.reduce((n,r)=>n+r.outside50.length,0));
 return p;
}

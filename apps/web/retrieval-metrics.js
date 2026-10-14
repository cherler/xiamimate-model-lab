export const RETRIEVAL_METHODS={bm25:'BM25 关键词',dense:'MiniLM 语义向量',hybrid:'RRF 混合检索',rerank:'Cross-encoder 重排'};
export function retrievalMetrics(ranking,relevant,k=10){
 const values=Object.values(relevant);
 if(!values.length||values.some(v=>!Number.isInteger(v)||v<=0)||new Set(ranking).size!==ranking.length||!Number.isInteger(k)||k<1)throw new Error('检索指标输入无效');
 const gains=ranking.slice(0,k).map(id=>relevant[id]||0);
 const dcg=seq=>seq.reduce((s,v,i)=>s+(2**v-1)/Math.log2(i+2),0);
 const first=gains.findIndex(v=>v>0),hits=gains.filter(v=>v>0).length;
 return {ndcg:dcg(gains)/dcg([...values].sort((a,b)=>b-a).slice(0,k)),recall:hits/values.length,mrr:first<0?0:1/(first+1),hits};
}
export function rrf(first,second,k=100){
 const scores=new Map();for(const list of [first,second])list.forEach((id,i)=>scores.set(id,(scores.get(id)||0)+1/(61+i)));
 return [...scores].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:a[0]>b[0]?1:0)).slice(0,k).map(p=>p[0]);
}
export function percentile(values,p){
 const a=[...values].sort((x,y)=>x-y),i=(a.length-1)*p,lo=Math.floor(i);return a[lo]+(a[Math.ceil(i)]-a[lo])*(i-lo);
}
export function compareQueries(queries,model,baseline){
 const result={improved:0,tied:0,worse:0};
 for(const q of queries){const d=q.metrics[model].ndcg_at_10-q.metrics[baseline].ndcg_at_10;result[Math.abs(d)<1e-12?'tied':d>0?'improved':'worse']++;}return result;
}
export function verifyRetrieval(p){
 const r=p.report;
 if(!r||r.run_id!==p.run_id||r.protocol?.version!=='scifact-retrieval-v1'||r.label_access?.status!=='completed'||r.rankings_sha256!==r.label_access.rankings_sha256||r.query_count!==300||r.document_count!==5183||p.queries?.length!==300||Object.keys(p.documents||{}).length!==5183||!p.notice?.includes('ODC-By'))throw new Error('检索结果范围或版本不一致');
 const near=(a,b)=>{if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1e-8)throw new Error('检索指标或耗时复算失败');};
 const identical=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 const ids=new Set();
 for(const [id,doc] of Object.entries(p.documents))if(!id||typeof doc.title!=='string'||typeof doc.text!=='string')throw new Error('文献字段缺失');
 for(const q of p.queries){
  if(ids.has(q.id)||!q.id||!q.text||!Object.keys(q.relevant||{}).length||Object.keys(q.relevant).some(id=>!Object.hasOwn(p.documents,id)))throw new Error('查询或标注文献无效');ids.add(q.id);
  for(const m of Object.keys(RETRIEVAL_METHODS)){
   const list=q.rankings?.[m];
   if(list?.length!==100||new Set(list).size!==100||list.some(id=>!Object.hasOwn(p.documents,id)))throw new Error('检索列表缺失或重复');
   const a=retrievalMetrics(list,q.relevant);
   for(const [key,value] of Object.entries({ndcg_at_10:a.ndcg,recall_at_10:a.recall,mrr_at_10:a.mrr,recall_at_50:retrievalMetrics(list,q.relevant,50).recall,recall_at_100:retrievalMetrics(list,q.relevant,100).recall}))near(value,q.metrics?.[m]?.[key]);
   if(!Number.isFinite(q.milliseconds?.[m])||q.milliseconds[m]<0)throw new Error('检索耗时无效');
  }
  const c=q.components_ms;
  if(!c||Object.values(c).some(v=>!Number.isFinite(v)||v<0))throw new Error('阶段耗时无效');
  near(q.milliseconds.bm25,c.bm25);near(q.milliseconds.dense,c.dense);near(q.milliseconds.hybrid,c.bm25+c.dense+c.fusion);near(q.milliseconds.rerank,c.bm25+c.dense+c.fusion+c.cross_encoder);
  if(!identical(rrf(q.rankings.bm25,q.rankings.dense),q.rankings.hybrid))throw new Error('融合排名不一致');
  if(!identical([...q.rankings.hybrid.slice(0,50)].sort(),[...q.rankings.rerank.slice(0,50)].sort())||!identical(q.rankings.hybrid.slice(50),q.rankings.rerank.slice(50)))throw new Error('重排改变了候选集合');
 }
 for(const m of Object.keys(RETRIEVAL_METHODS)){
  for(const key of ['ndcg_at_10','recall_at_10','mrr_at_10','recall_at_50','recall_at_100'])near(p.queries.reduce((s,q)=>s+q.metrics[m][key],0)/p.queries.length,r.summary?.[m]?.[key]);
  for(const [key,v] of [['p50',.5],['p95',.95]])near(percentile(p.queries.map(q=>q.milliseconds[m]),v),r.timing_ms?.[m]?.[key]);
 }
 return p;
}

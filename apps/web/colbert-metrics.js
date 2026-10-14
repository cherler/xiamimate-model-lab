import {retrievalMetrics,percentile} from './retrieval-metrics.js';
export const COLBERT_METHODS={cross_first:'交叉编码器 · 首块',colbert_first:'ColBERT · 首块',cross_chunks:'交叉编码器 · 全块取最高',colbert_chunks:'ColBERT · 全块取最高'};
export const STUDY_METHODS=['parent_hybrid','parent_rerank',...Object.keys(COLBERT_METHODS)];
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const near=(a,b,tol=1e-8)=>{if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>tol)throw new Error('ColBERT 数值或解释不一致');};
export function verifyColbert(p,parent){
 if(p.protocol?.version!=='colbert-scifact-development-v1'||p.protocol.evidence!=='known_benchmark_development_after_prior_feedback'||p.rows?.length!==300||new Set(p.rows.map(r=>r.id)).size!==300||!p.core_parity?.passed||p.core_parity.max_embedding_error>1e-5||p.core_parity.max_score_error>1e-5||!p.notice?.includes('ODC-By')||!p.notice.includes('MIT'))throw new Error('ColBERT 实验范围或核心核对无效');
 if(parent&&(p.protocol.parent_run!==parent.run_id||parent.queries.length!==300))throw new Error('ColBERT 来源版本不一致');
 const source=new Map(parent?.queries.map(q=>[q.id,q])||[]);
 const metricKeys=['ndcg_at_10','recall_at_10','mrr_at_10','recall_at_50','recall_at_100'];
 const allDocs=new Set();
 for(const r of p.rows){
  const old=source.get(r.id),pool=r.rankings.parent_hybrid.slice(0,50),tail=r.rankings.parent_hybrid.slice(50);pool.forEach(id=>allDocs.add(id));
  if(!r.text||typeof r.used_query!=='string'||!r.text.startsWith(r.used_query)||!r.used_query||!Number.isInteger(r.query_wordpieces)||!Number.isFinite(r.pool_multichunk_share)||r.pool_multichunk_share<0||r.pool_multichunk_share>1)throw new Error('ColBERT 查询字段无效');
  if(parent&&(!old||old.text!==r.text||!same(old.rankings.hybrid,r.rankings.parent_hybrid)||!same(old.rankings.rerank,r.rankings.parent_rerank)||JSON.stringify(old.relevant)!==JSON.stringify(r.relevant)))throw new Error('ColBERT 修改原查询／候选／标签');
  near(r.candidate_recall,retrievalMetrics(pool,r.relevant,50).recall);
  for(const m of STUDY_METHODS){
   const list=r.rankings[m];if(list?.length!==100||new Set(list).size!==100||!same([...pool].sort(),list.slice(0,50).sort())||!same(tail,list.slice(50)))throw new Error('ColBERT 改变候选池或尾部');
   const a=retrievalMetrics(list,r.relevant),actual=[a.ndcg,a.recall,a.mrr,retrievalMetrics(list,r.relevant,50).recall,retrievalMetrics(list,r.relevant,100).recall];
   metricKeys.forEach((key,i)=>near(r.metrics?.[m]?.[key],actual[i]));
   if(Object.hasOwn(COLBERT_METHODS,m)){
    const scores=r.scores?.[m];if(!scores||!same(Object.keys(scores).sort(),[...pool].sort())||Object.values(scores).some(x=>!Number.isFinite(x)))throw new Error('ColBERT 候选分数不完整');
    const sorted=[...pool].sort((a,b)=>scores[b]-scores[a]||(a<b?-1:a>b?1:0));if(!same(sorted,list.slice(0,50)))throw new Error('ColBERT 分数与排序不一致');
    if(!Number.isFinite(r.milliseconds?.[m])||r.milliseconds[m]<0)throw new Error('ColBERT 耗时无效');
   }
  }
  if(!same(Object.keys(r.matches).sort(),r.rankings.colbert_chunks.slice(0,3).sort()))throw new Error('ColBERT 样本依据不完整');
  for(const [id,x] of Object.entries(r.matches)){
   if(!p.titles[id]||x.tokens.length!==p.protocol.query_maxlen||!Number.isInteger(x.chunk_index)||x.chunk_index<0||x.chunk_index>=x.chunk_count||x.chunk_index!==r.best_chunks[id]||!Number.isInteger(x.chunk.start)||x.chunk.start<0||x.chunk.end<=x.chunk.start||x.chunk.text.length!==x.chunk.end-x.chunk.start||x.tokens.some(t=>typeof t.q!=='string'||typeof t.d!=='string'||!Number.isFinite(t.v)))throw new Error('ColBERT 片段或 token 依据无效');
   near(x.tokens.reduce((s,t)=>s+t.v,0),x.score,2e-5);near(x.score,r.scores.colbert_chunks[id],2e-5);
   if(parent){const d=parent.documents[id],text=d.title+' '+d.text;if(text.slice(x.chunk.start,x.chunk.end)!==x.chunk.text||d.title!==p.titles[id])throw new Error('ColBERT 引文与原文不一致');}
  }
 }
 if(allDocs.size!==p.costs.candidate_documents||Object.keys(p.titles).length!==allDocs.size)throw new Error('ColBERT 文献范围不一致');
 for(const m of STUDY_METHODS)for(const k of metricKeys)near(p.summary?.[m]?.[k],mean(p.rows.map(r=>r.metrics[m][k])));
 for(const m of Object.keys(COLBERT_METHODS))for(const [key,q] of [['median',.5],['p95',.95]])near(p.timing?.[m]?.[key],percentile(p.rows.map(r=>r.milliseconds[m]),q));
 const filters={short_query:r=>r.query_wordpieces<=29,long_query:r=>r.query_wordpieces>29,pool_mostly_multichunk:r=>r.pool_multichunk_share>=.8,other_pool:r=>r.pool_multichunk_share<.8};
 for(const [key,fn] of Object.entries(filters)){const rows=p.rows.filter(fn),g=p.groups[key];if(g?.n!==rows.length)throw new Error('ColBERT 分组数量不一致');if(!rows.length){if(g.metrics!==null)throw new Error('ColBERT 空组有成绩');continue;}for(const m of STUDY_METHODS)for(const k of metricKeys)near(g.metrics[m][k],mean(rows.map(r=>r.metrics[m][k])));}
 const pairs=[['colbert_first','cross_first'],['colbert_chunks','cross_chunks'],['colbert_chunks','colbert_first'],['cross_chunks','cross_first']];
 if(p.comparisons?.length!==pairs.length)throw new Error('ColBERT 配对对照缺失');
 pairs.forEach(([a,b],i)=>{const c=p.comparisons[i];if(c.model!==a||c.baseline!==b)throw new Error('ColBERT 配对范围改变');const delta=p.rows.map(r=>r.metrics[a].ndcg_at_10-r.metrics[b].ndcg_at_10);near(c.ndcg_delta,mean(delta));if(c.wins!==delta.filter(x=>x>1e-12).length||c.losses!==delta.filter(x=>x< -1e-12).length||c.ties!==delta.filter(x=>Math.abs(x)<=1e-12).length||c.bootstrap_ci95.length!==2||!c.bootstrap_ci95.every(Number.isFinite)||c.bootstrap_ci95[0]>c.bootstrap_ci95[1])throw new Error('ColBERT 改善退步统计无效');});
 return p;
}

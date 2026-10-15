import {COLBERT_METHODS as METHODS} from './colbert-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:4});
const pct=v=>`${(v*100).toFixed(2)}%`;
const table=(headers,rows,label)=>`<div class="table-scroll retrieval-table" tabindex="0" role="region" aria-label="${label}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export function retrievalExperiment(params,view='experience'){return params.get('experiment')==='colbert'||(!params.has('experiment')&&!params.has('model')&&view==='experience');}
export const COLBERT_PAIRS={
 model_full:{index:1,label:'同文本换模型：全块 ColBERT / 交叉编码器'},
 model_first:{index:0,label:'同文本换模型：首块 ColBERT / 交叉编码器'},
 coverage_colbert:{index:2,label:'同模型扩展文本：ColBERT 全块 / 首块'},
 coverage_cross:{index:3,label:'同模型扩展文本：交叉编码器全块 / 首块'},
};
const OUTCOMES={all:'全部查询',better:'当前方法改善',worse:'当前方法退步',tied:'两者持平'};
const select=(id,label,choices,value)=>`<label for="${id}">${label}<select id="${id}">${Object.entries(choices).map(([k,v])=>`<option value="${k}" ${k===value?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
export function colbertSelection(p,params){
 const pair=Object.hasOwn(COLBERT_PAIRS,params.get('colbertPair'))?params.get('colbertPair'):'model_full';
 const outcome=Object.hasOwn(OUTCOMES,params.get('colbertOutcome'))?params.get('colbertOutcome'):'all';
 const comparison=p.comparisons[COLBERT_PAIRS[pair].index];
 const rows=p.rows.filter(r=>{
  const d=r.metrics[comparison.model].ndcg_at_10-r.metrics[comparison.baseline].ndcg_at_10;
  return outcome==='all'||(outcome==='better'?d>1e-12:outcome==='worse'?d< -1e-12:Math.abs(d)<=1e-12);
 });
 const row=rows.find(r=>r.id===params.get('query'))||rows[0];
 return {pair,outcome,comparison,rows,row};
}
export function colbertHref(s,view='experience'){
 return '#retrieve?'+new URLSearchParams({case:'scifact',view,experiment:'colbert',colbertPair:s.pair,colbertOutcome:s.outcome,...(s.row?{query:s.row.id}:{})});
}
function documentCell(parent,q,method,other,i){
 const id=q.rankings[method][i],d=parent.documents[id],rank=q.rankings[other].indexOf(id)+1;
 return `<strong lang="en">${esc(d.title)}</strong><p>${Object.hasOwn(q.relevant,id)?'标注相关':'未标注相关'} · 对照列第 ${rank} 名</p><details><summary>摘要与文献 ${esc(id)}</summary><p lang="en">${esc(d.text)}</p></details>`;
}
function matchesHtml(q,p){
 return `<details class="colbert-proof"><summary>查看 ColBERT 全块前三篇的真实匹配依据</summary><p>此处固定解释 ColBERT 全块方案；其他三种方案未导出同样的词元贡献。原文片段与评分均来自保存推理，不是生成说明。</p>${q.rankings.colbert_chunks.slice(0,3).map(id=>{
 const x=q.matches[id],ordinary=x.tokens.filter(t=>!/^\[.*\]$/.test(t.q)),special=x.tokens.filter(t=>/^\[.*\]$/.test(t.q));
 return `<details><summary>${esc(p.titles[id])} · ${Object.hasOwn(q.relevant,id)?'标注相关':'未标注相关'}</summary><p>文献 ${esc(id)}；最高分片段 ${x.chunk_index+1} / ${x.chunk_count}，MaxSim 得分 ${num(x.score)}。字符范围 [${x.chunk.start}, ${x.chunk.end})。</p><blockquote lang="en">${esc(x.chunk.text)}</blockquote>${table(['查询词元','片段匹配词元','相似度贡献'],ordinary.map(t=>[esc(t.q),esc(t.d),num(t.v)]),'普通词元匹配依据')}<p>普通词元合计 ${num(ordinary.reduce((a,t)=>a+t.v,0))}，特殊标记与 MASK 槽合计 ${num(special.reduce((a,t)=>a+t.v,0))}；两者组成完整评分。MASK 是模型扩展槽，不是用户输入。分数不是概率，词元匹配不代表理解了因果或证实了主张。</p><details><summary>特殊标记与 MASK 明细</summary>${table(['模型槽','片段词元','贡献'],special.map(t=>[esc(t.q),esc(t.d),num(t.v)]),'特殊槽匹配依据')}</details></details>`;
 }).join('')}</details>`;
}
export function colbertExperienceHtml(p,parent,s){
 const {comparison:c,row:q,rows}=s,a=c.model,b=c.baseline;
 const summary=`<section class="colbert-overview"><h2>同一批候选，比较模型与文本覆盖</h2><p>已有研究提示长摘要截断可能遗漏信息。本实验固定混合检索前 50 篇候选，把“换模型”和“增加可读文本”分别比较。以下是已运行的 300 条英文查询，不运行新的搜索。</p><div class="lesson-controls">${select('colbert-pair','本次比较的问题',Object.fromEntries(Object.entries(COLBERT_PAIRS).map(([k,v])=>[k,v.label])),s.pair)}</div><p class="validation-boundary"><strong>全体查询 NDCG@10：${num(p.summary[b].ndcg_at_10)} → ${num(p.summary[a].ndcg_at_10)}</strong><br>${METHODS[b]} → ${METHODS[a]}；差值 ${num(c.ndcg_delta)}。${c.wins} 条改善、${c.losses} 条退步、${c.ties} 条持平。${s.pair.startsWith('model')?'两侧使用同一文本范围，检查模型差异。':'两侧使用同一模型，检查文本覆盖影响，不能称作换模型增益。'}</p>${table(['全体 300 查询','NDCG@10 ↑','Recall@10 ↑','重排中位 / P95（ms）'],[b,a].map(m=>[METHODS[m],num(p.summary[m].ndcg_at_10),pct(p.summary[m].recall_at_10),`${p.timing[m].median.toFixed(2)} / ${p.timing[m].p95.toFixed(2)}`]),'全体质量与重排代价')}<p>ColBERT 使用预先缓存的文档向量：离线编码 ${num(p.costs.colbert_encoding_seconds)} 秒，${num(p.costs.candidate_documents)} 篇候选文献的未压缩向量负载 ${num(p.costs.float32_vector_bytes/1048576)} MiB。交叉编码器每次编码查询文档对；不能只比较查询耗时而忽略预计算与存储。</p><p class="small-note">耗时来自本机 ${p.environment.threads} CPU 线程的单次预热回放，均不含候选召回、加载与网络，不是端到端服务延迟。已知公开基准开发结果，未本地微调，可能存在预训练重叠。</p><details><summary>配对区间与采用条件</summary><p>NDCG 差值的 95% 查询重采样区间为 ${c.bootstrap_ci95.map(num).join(' ～ ')}（2,000 次、种子 42）。只描述这批查询的抽样波动，不代表新领域效果。</p><p>本例展示：在固定候选下控制文本覆盖、比较重排方法，再用退步查询与计算代价决定是否采用。文档能离线编码、查询频繁且允许维护缓存时，值得验证多向量重排；频繁更新、内存受限或中文领域须另做测试。没有验证并发、增量索引和生产可用性。</p><p>受控实验 ${esc(p.run_id)}；父实验 ${esc(p.protocol.parent_run)}。原四方法结果仍保留在“基础召回与融合”。</p></details></section>`;
 const controls=`<section class="m5-section"><h2>查看同一查询的结果差异</h2><div class="lesson-controls">${select('colbert-outcome','按当前对照筛选',OUTCOMES,s.outcome)}${rows.length?select('colbert-query',`已评估查询（${rows.length} 条）`,Object.fromEntries(rows.map(r=>[r.id,`${r.id} · ${r.text}`])),q.id):''}</div><p class="small-note">按查询编号排列，不默认挑选改善样本；筛选只改变下方回放，全体成绩始终覆盖 300 条。</p>`;
 if(!q)return summary+controls+'<p role="status">当前分组没有查询，请切换筛选。</p></section>';
 const missed=Object.keys(q.relevant).filter(id=>!q.rankings.parent_hybrid.slice(0,50).includes(id));
 const delta=q.metrics[a].ndcg_at_10-q.metrics[b].ndcg_at_10;
 return summary+controls+`<h3 lang="en">${esc(q.text)}</h3><p>本查询 NDCG@10 ${delta>1e-12?'改善':delta< -1e-12?'退步':'持平'}：${num(q.metrics[b].ndcg_at_10)} → ${num(q.metrics[a].ndcg_at_10)}；单条结果不代表整体增益。</p><p>查询输入${q.text===q.used_query?'完整保留':`已截断为：${esc(q.used_query)}`}。两侧都只重排原前 50，原 51–100 不变；全部查询的候选 Recall@50 固定为 ${pct(p.summary.parent_hybrid.recall_at_50)}，本查询池外标注相关文献 ${missed.length} 篇。重排不能找回池外文献。</p>${missed.length?`<details><summary>查看池外相关文献</summary><ul>${missed.map(id=>`<li>${esc(id)} · ${esc(parent.documents[id].title)}</li>`).join('')}</ul></details>`:''}<p class="small-note">未标注相关不等于确知无关；文献排序不判断科学主张真伪。两种模型原始分数不可直接比较。</p>${table(['名次',METHODS[b],METHODS[a]],Array.from({length:10},(_,i)=>[i+1,documentCell(parent,q,b,a,i),documentCell(parent,q,a,b,i)]),'同一查询前十篇对照')}${matchesHtml(q,p)}<p><a href="${esc(colbertHref(s,'report'))}">查看完整评估、四组对照与来源 →</a></p></section>`;
}

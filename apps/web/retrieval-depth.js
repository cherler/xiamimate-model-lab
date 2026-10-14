import {RETRIEVAL_METHODS as METHODS,retrievalMetrics,percentile} from './retrieval-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'不适用':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:4});
const pct=v=>v==null?'不适用':`${(v*100).toFixed(2)}%`;
const table=(heads,rows,label)=>`<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(label)}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const STAGES={not_recalled:'两路前 100 均未召回',fusion_cut:'进入两路联合，但未进融合前 100',pool_cut:'融合第 51～100，未进入重排池',rank_cut:'进入重排池，但未进展示前 K',hit:'进入重排前 K'};
export const tokens=text=>text.toLowerCase().match(/[a-z0-9]+/g)||[];
const rank=(list,id)=>{const i=list.indexOf(id);return i<0?null:i+1;};
const position=n=>n==null?'未进前 100':`第 ${n} 名`;
export function documentTrace(q,id,k=10){
 if(![5,10].includes(k))throw new Error('仅支持已展示的 K=5 或 K=10');
 const ranks=Object.fromEntries(Object.keys(METHODS).map(m=>[m,rank(q.rankings[m],id)]));
 const contributions={bm25:ranks.bm25?1/(60+ranks.bm25):0,dense:ranks.dense?1/(60+ranks.dense):0};
 const stage=ranks.bm25==null&&ranks.dense==null?'not_recalled':ranks.hybrid==null?'fusion_cut':ranks.hybrid>50?'pool_cut':ranks.rerank>k?'rank_cut':'hit';
 const before=ranks.hybrid!=null&&ranks.hybrid<=k,after=ranks.rerank!=null&&ranks.rerank<=k;
 return {ranks,contributions,rrf:contributions.bm25+contributions.dense,stage,change:before&&after?'retained':before?'removed':after?'promoted':'outside'};
}
export function pipelineCounts(queries,k=10){
 const counts=Object.fromEntries(Object.keys(STAGES).map(s=>[s,0]));let total=0,promoted=0,removed=0;
 for(const q of queries)for(const id of Object.keys(q.relevant)){const t=documentTrace(q,id,k);counts[t.stage]++;total++;if(t.change==='promoted')promoted++;if(t.change==='removed')removed++;}
 return {counts,total,promoted,removed};
}
export function termEvidence(query,document){
 const queryTerms=[...new Set(tokens(query))],title=new Set(tokens(document.title)),body=new Set(tokens(document.text));
 return {queryTerms,title:queryTerms.filter(t=>title.has(t)),body:queryTerms.filter(t=>body.has(t)),missing:queryTerms.filter(t=>!title.has(t)&&!body.has(t))};
}
function highlighted(text,terms){const set=new Set(terms);return text.split(/([a-z0-9]+)/ig).map(part=>set.has(part.toLowerCase())?`<mark>${esc(part)}</mark>`:esc(part)).join('');}
export function traceView(p,q,s){
 const ids=[...new Set([...Object.keys(q.relevant),...Object.values(q.rankings).flat()])].sort();
 if(!ids.includes(s.document))s.document=Object.keys(q.relevant).sort()[0];
 const id=s.document,d=p.documents[id],t=documentTrace(q,id,s.k),e=termEvidence(q.text,d),c=pipelineCounts([q],s.k);
 return `<section class="m5-section retrieval-trace"><h2>一篇文献从召回到重排的路径</h2><p>固定流程：关键词与向量各取 100 → 融合前 100 → 只重排前 50 → 展示前 ${s.k}。此处始终解释这条流程，不随上方两种方法配对改变。默认按编号选第一篇标注文献，不按效果挑选。</p><label for="ret-document">追踪文献（保存候选与标注文献，共 ${ids.length} 篇）<select id="ret-document">${ids.map(doc=>`<option value="${esc(doc)}" ${id===doc?'selected':''}>${esc(doc)} · ${Object.hasOwn(q.relevant,doc)?'标注相关':'未标注相关'} · ${esc(p.documents[doc].title)}</option>`).join('')}</select></label><h3 lang="en">${esc(d.title)}</h3><div class="depth-verdict"><strong>${STAGES[t.stage].replace('K',String(s.k))}</strong><p>${Object.hasOwn(q.relevant,id)?'该文献标注相关。':'该文献未标注相关，不能认定它确实无关。'}${{promoted:'重排将它从前 K 外提升到前 K 内。',removed:'它原在融合前 K，重排后移出前 K。',retained:'融合与重排均在前 K 内；具体名次仍可能变化。',outside:'融合与重排均未进入展示前 K。'}[t.change].replaceAll('K',String(s.k))}</p></div>${table(['阶段','同一文献的名次','可核对的处理'],[['BM25 关键词',position(t.ranks.bm25),'以词项匹配召回前 100'],['MiniLM 语义向量',position(t.ranks.dense),'以预训练向量匹配召回前 100'],['RRF 混合',position(t.ranks.hybrid),`由两路排名计算融合分数 ${t.rrf.toFixed(6)}`],['交叉编码重排',position(t.ranks.rerank),t.ranks.hybrid!=null&&t.ranks.hybrid<=50?'进入前 50，重新排序':'未进入重排前 50；不能靠本次重排找回']],'同一文献四阶段名次')}<div class="depth-duel"><section><h3>可观察的关键词匹配</h3><p>标题命中：${e.title.length?e.title.map(esc).join('、'):'无'}。</p><p>标题与摘要均未出现：${e.missing.length?e.missing.map(esc).join('、'):'无'}。</p><p class="small-note">按本例 BM25 的 ASCII 字母数字分词核对，包括普通功能词；命中词数不是 BM25 分数，也不证明语义或研究结论一致。</p></section><section><h3>语义方法的证据边界</h3><p>向量和重排名次来自保存推理。词面不同仍被召回，可以作为核查语义匹配的线索；不能仅据名次推断模型理解了同义、否定或因果关系。</p><p>尚无逐 token 贡献或受控改写实验。原文匹配只辅助人工阅读，不作为模型内部归因。</p></section></div><details class="depth-calculation"><summary>查看原文词项、融合计算与截断范围</summary><p lang="en">查询：${highlighted(q.text,e.queryTerms)}</p><h4 lang="en">${highlighted(d.title,e.queryTerms)}</h4><p lang="en">${highlighted(d.text,e.queryTerms)}</p><p>融合贡献：关键词 ${t.contributions.bm25.toFixed(6)} ＋ 向量 ${t.contributions.dense.toFixed(6)} ＝ ${t.rrf.toFixed(6)}。每路出现时贡献 1／(60＋名次)，否则为零；并列按文献编号排序。</p><p>高亮基于完整标题与摘要。向量输入和交叉编码输入上限各为 256 个模型 token，后者包含查询；原文尾部高亮不保证实际进入神经模型。本页未导出 token 截断位置。</p></details><h3>本查询全部标注文献的失败位置</h3>${table(['固定流程阶段','相关文献数'],Object.entries(STAGES).map(([key,label])=>[label.replace('K',String(s.k)),c.counts[key]]),'当前查询标注对的完整阶段统计')}<p class="small-note">分母为 ${c.total} 篇标注文献，每篇只计一个最终阶段；未标注文献不计入此失败统计。<a href="#retrieve?${new URLSearchParams({case:'scifact',view:'report',model:s.model,baseline:s.base,k:s.k,groupBy:s.groupBy||'length',group:s.group||'all'})}">查看全部查询的阶段遗漏、分组与成本 →</a></p></section>`;
}

// D4 descriptive rules: fixed from query text before computing any group scores.
// These are post-hoc diagnostics, not a pre-registered independent benchmark.
export const GROUPS={length:{label:'查询词项长度',groups:{short:'≤10 词项',medium:'11～20 词项',long:'≥21 词项'}},digits:{label:'数字字符',groups:{yes:'包含数字',no:'不含数字'}},negation:{label:'显式否定词',groups:{yes:'包含指定否定词',no:'不含指定否定词'}}};
export function queryGroup(text,dimension){
 const terms=tokens(text);
 if(dimension==='length')return terms.length<=10?'short':terms.length<=20?'medium':'long';
 if(dimension==='digits')return /[0-9]/.test(text)?'yes':'no';
 if(dimension==='negation')return terms.some(t=>['no','not','without','neither','nor'].includes(t))?'yes':'no';
 throw new Error('未知查询分组维度');
}
export function groupedQueries(queries,dimension,group='all'){
 if(!Object.hasOwn(GROUPS,dimension))throw new Error('未知查询分组维度');
 if(group==='all')return queries;
 if(!Object.hasOwn(GROUPS[dimension].groups,group))throw new Error('未知查询组');
 return queries.filter(q=>queryGroup(q.text,dimension)===group);
}
export function groupSummary(queries,model,base,k=10){
 if(!Object.hasOwn(METHODS,model)||!Object.hasOwn(METHODS,base)||![5,10].includes(k))throw new Error('无效的比较口径');
 const n=queries.length,summary={n,improved:0,tied:0,worse:0};
 for(const method of new Set([model,base])){
  const scores=queries.map(q=>retrievalMetrics(q.rankings[method],q.relevant,k));
  summary[method]=Object.fromEntries(['ndcg','recall','mrr'].map(key=>[key,n?scores.reduce((a,b)=>a+b[key],0)/n:null]));
  for(const [key,p] of [['p50',.5],['p95',.95]])summary[method][key]=n?percentile(queries.map(q=>q.milliseconds[method]),p):null;
 }
 for(const q of queries){const delta=retrievalMetrics(q.rankings[model],q.relevant,k).ndcg-retrievalMetrics(q.rankings[base],q.relevant,k).ndcg;summary[Math.abs(delta)<1e-12?'tied':delta>0?'improved':'worse']++;}
 return summary;
}
const choice=(id,label,options,value)=>`<label for="${id}">${label}<select id="${id}">${Object.entries(options).map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
export function groupView(p,s){
 const dim=GROUPS[s.groupBy],all=groupSummary(p.queries,s.model,s.base,s.k),rows=Object.entries(dim.groups).map(([key,label])=>({key,label,...groupSummary(groupedQueries(p.queries,s.groupBy,key),s.model,s.base,s.k)}));
 const selected=groupSummary(groupedQueries(p.queries,s.groupBy,s.group),s.model,s.base,s.k),a=selected[s.model],b=selected[s.base];
 return `<section class="m5-section retrieval-groups"><h2>哪些查询受益，哪些查询退步</h2><p>按查询原文的可复算特征分组，比较 ${METHODS[s.model]} 与 ${METHODS[s.base]}。同一维度覆盖全部 ${p.queries.length} 条，每条只属于一组；不会删除退步查询或小样本组。</p><div class="lesson-controls">${choice('ret-group-by','分组依据',Object.fromEntries(Object.entries(GROUPS).map(([k,v])=>[k,v.label])),s.groupBy)}${choice('ret-group','查看范围',{all:'全部查询',...dim.groups},s.group)}${choice('ret-k','诊断展示条数 K',{'5':'前 5 条','10':'前 10 条'},String(s.k))}</div>${table(['查询组','条数 / 覆盖率',`NDCG@${s.k} 当前 / 对照`,'差值','改善 / 持平 / 退步','P50 当前 / 对照（ms）'],[{label:'全部查询',...all},...rows].map(row=>[row.label,`${row.n} / ${pct(row.n/p.queries.length)}`,`${num(row[s.model].ndcg)} / ${num(row[s.base].ndcg)}`,row.n?num(row[s.model].ndcg-row[s.base].ndcg):'不适用',`${row.improved} / ${row.tied} / ${row.worse}`,`${num(row[s.model].p50)} / ${num(row[s.base].p50)}`]),'查询特征分组的质量与成本')}<div class="depth-verdict"><strong>${s.group==='all'?'全部查询':esc(dim.groups[s.group])}：${selected.n} 条的效果与耗时</strong>${selected.n?`<p>NDCG@${s.k} 差 ${num(a.ndcg-b.ndcg)}；Recall@${s.k} 差 ${num((a.recall-b.recall)*100)} 个百分点；MRR@${s.k} 差 ${num(a.mrr-b.mrr)}。P50 差 ${num(a.p50-b.p50)} ms，P95 差 ${num(a.p95-b.p95)} ms。</p><p>P95 当前 ${num(a.p95)} ms／对照 ${num(b.p95)} ms。耗时差是两组分位数之差；不等于逐查询耗时差的分位数。</p>`:'<p>没有查询，不生成指标或优势结论。</p>'}</div><p>若增加重排只带来很小的排名收益，却增加大量耗时，可先交付混合检索，再用目标领域的人工标注验证重排是否必要。当前收益仅是公开基准的离线差异，不能换算成客户收入或生产吞吐。</p><details class="depth-calculation"><summary>分组规则、样本范围与统计限制</summary><p>本次 D4 在已有整体结果之上增加事后描述性诊断；分组规则先于本次分组汇总固定，未作为训练、选参或独立验收依据。长度按小写 ASCII 字母数字连续片段计数，重复词也计数，按 ≤10、11～20、≥21 分组。数字指原文含 0～9。否定词仅检查 no、not、without、neither、nor；不是语义否定识别，术语缩写也可能命中。</p><p>各组指标先逐查询计算再等权平均；各组按样本数加权可还原总体。改善按 NDCG@${s.k} 差值，绝对差小于 10⁻¹² 记持平。P50/P95 从该组保存的逐查询总耗时重新计算，不相加阶段分位数。分组小、彼此存在主题差异，未做显著性检验，不作因果归因或跨领域优劣承诺。</p></details></section>`;
}
export function pipelineView(p,k=10){
 const c=pipelineCounts(p.queries,k);
 return `<section class="m5-section retrieval-pipeline"><h2>相关文献在流程中遗漏在哪里</h2><p>以下固定检查混合检索 → 前 50 重排 → 前 ${k} 展示，不随两种方法配对变化。覆盖全部 ${p.queries.length} 条查询、${c.total} 个标注相关查询－文献对。</p>${table(['最终阶段','相关对数量 / 占比','应优先核查'],Object.entries(STAGES).map(([key,label])=>[label.replace('K',String(k)),`${c.counts[key]} / ${pct(c.counts[key]/c.total)}`,{not_recalled:'两路召回与文本表示；重排无法补回',fusion_cut:'两路候选融合后的截断',pool_cut:'重排池大小与延迟预算',rank_cut:'查询与候选匹配、重排和文本截断',hit:'仍需人工核查相关性与标注覆盖'}[key]]),'全部相关对的阶段遗漏')}<p>重排相对混合检索：把 ${c.promoted} 个标注相关对提升进前 ${k}，也把 ${c.removed} 个移出，净变化 ${c.promoted-c.removed} 个。重排只能调整已有前 50，不能找回池外文献。</p><p class="small-note">同一文献在不同查询下分别计数；这是按相关对统计，不等于逐查询平均 Recall。未标注文献不计入遗漏数量，也不据此判为确定无关。具体证据可从下方查询列表进入回放。</p></section>`;
}

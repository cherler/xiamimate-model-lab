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
 return `<section class="m5-section retrieval-trace"><h2>一篇文献从召回到重排的路径</h2><p>固定流程：关键词与向量各取 100 → 融合前 100 → 只重排前 50 → 展示前 ${s.k}。此处始终解释这条流程，不随上方两种方法配对改变。默认按编号选第一篇标注文献，不按效果挑选。</p><label for="ret-document">追踪文献（保存候选与标注文献，共 ${ids.length} 篇）<select id="ret-document">${ids.map(doc=>`<option value="${esc(doc)}" ${id===doc?'selected':''}>${esc(doc)} · ${Object.hasOwn(q.relevant,doc)?'标注相关':'未标注相关'} · ${esc(p.documents[doc].title)}</option>`).join('')}</select></label><h3 lang="en">${esc(d.title)}</h3><div class="depth-verdict"><strong>${STAGES[t.stage].replace('K',String(s.k))}</strong><p>${Object.hasOwn(q.relevant,id)?'该文献标注相关。':'该文献未标注相关，不能认定它确实无关。'}${{promoted:'重排将它从前 K 外提升到前 K 内。',removed:'它原在融合前 K，重排后移出前 K。',retained:'融合与重排均在前 K 内；具体名次仍可能变化。',outside:'融合与重排均未进入展示前 K。'}[t.change].replaceAll('K',String(s.k))}</p></div>${table(['阶段','同一文献的名次','可核对的处理'],[['BM25 关键词',position(t.ranks.bm25),'以词项匹配召回前 100'],['MiniLM 语义向量',position(t.ranks.dense),'以预训练向量匹配召回前 100'],['RRF 混合',position(t.ranks.hybrid),`由两路排名计算融合分数 ${t.rrf.toFixed(6)}`],['交叉编码重排',position(t.ranks.rerank),t.ranks.hybrid!=null&&t.ranks.hybrid<=50?'进入前 50，重新排序':'未进入重排前 50；不能靠本次重排找回']],'同一文献四阶段名次')}<div class="depth-duel"><section><h3>可观察的关键词匹配</h3><p>标题命中：${e.title.length?e.title.map(esc).join('、'):'无'}。</p><p>标题与摘要均未出现：${e.missing.length?e.missing.map(esc).join('、'):'无'}。</p><p class="small-note">按本例 BM25 的 ASCII 字母数字分词核对，包括普通功能词；命中词数不是 BM25 分数，也不证明语义或研究结论一致。</p></section><section><h3>语义方法的证据边界</h3><p>向量和重排名次来自保存推理。词面不同仍被召回，可以作为核查语义匹配的线索；不能仅据名次推断模型理解了同义、否定或因果关系。</p><p>尚无逐 token 贡献或受控改写实验。原文匹配只辅助人工阅读，不作为模型内部归因。</p></section></div><details class="depth-calculation"><summary>查看原文词项、融合计算与截断范围</summary><p lang="en">查询：${highlighted(q.text,e.queryTerms)}</p><h4 lang="en">${highlighted(d.title,e.queryTerms)}</h4><p lang="en">${highlighted(d.text,e.queryTerms)}</p><p>融合贡献：关键词 ${t.contributions.bm25.toFixed(6)} ＋ 向量 ${t.contributions.dense.toFixed(6)} ＝ ${t.rrf.toFixed(6)}。每路出现时贡献 1／(60＋名次)，否则为零；并列按文献编号排序。</p><p>高亮基于完整标题与摘要。向量输入和交叉编码输入上限各为 256 个模型 token，后者包含查询；原文尾部高亮不保证实际进入神经模型。本页未导出 token 截断位置。</p></details><h3>本查询全部标注文献的失败位置</h3>${table(['固定流程阶段','相关文献数'],Object.entries(STAGES).map(([key,label])=>[label.replace('K',String(s.k)),c.counts[key]]),'当前查询标注对的完整阶段统计')}<p class="small-note">分母为 ${c.total} 篇标注文献，每篇只计一个最终阶段；未标注文献不计入此失败统计。<a href="#retrieve?${new URLSearchParams({case:'scifact',view:'report',model:s.model,baseline:s.base,k:s.k})}">查看全部查询的阶段遗漏、分组与成本 →</a></p></section>`;
}

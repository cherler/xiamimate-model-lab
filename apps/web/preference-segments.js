const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:3});
const pct=v=>v==null?'—':`${(v*100).toFixed(2)}%`;
export const PREFERENCE_METHODS={leiden:'Leiden · 商品偏好社群',kmeans:'偏好 K-means · 4 群',matched:'偏好 K-means · 与 Leiden 同群数',hdbscan:'HDBSCAN · 密度核心群',rfm:'原 RFM K-means · 价值对照'};
const table=(headers,rows,label)=>`<div class="table-scroll monitoring-table" role="region" tabindex="0" aria-label="${esc(label)}"><table><thead><tr>${headers.map(x=>`<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const select=(id,label,options,value)=>`<label>${esc(label)}<select id="${id}">${options.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
const groupName=(method,g)=>g<0?'未归群':`${method==='leiden'?'社群':'群'} ${g+1}`;
const close=(a,b)=>a===b||(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-9);
export function verifyPreference(p){
 if(p.schema!==1||p.protocol?.evidence!=='development_after_prior_feedback'||p.windows?.length!==2)throw new Error('偏好分群版本无效');
 for(const w of p.windows){
  const ids=new Set(w.rows.map(r=>r.id));if(ids.size!==w.rows.length||w.all_customers!==ids.size+w.excluded_ids.length)throw new Error('偏好分群人群不一致');
  for(const method of Object.keys(PREFERENCE_METHODS)){
   const metrics=w.metrics[method],profiles=w.profiles[method],counts=new Map();
   for(const r of w.rows){const g=r.labels[method];if(!Number.isInteger(g)||g< -1)throw new Error('无效分群');counts.set(g,(counts.get(g)||0)+1);}
   if(profiles.length!==counts.size||profiles.some(g=>g.n!==counts.get(g.id)||!close(g.share,g.n/ids.size)||g.rfm_counts.reduce((a,b)=>a+b,0)!==g.n))throw new Error('分群画像分母不一致');
   for(const g of profiles){const members=w.rows.filter(r=>r.labels[method]===g.id);for(let i=0;i<4;i++)if(g.rfm_counts[i]!==members.filter(r=>r.labels.rfm===i).length)throw new Error('RFM 交叉画像不一致');}
   const sample=new Set(w.silhouette_ids);if(sample.size!==w.silhouette_ids.length||[...sample].some(id=>!ids.has(id))||metrics.silhouette_n!==w.rows.filter(r=>sample.has(r.id)&&r.labels[method]>=0).length)throw new Error('轮廓评价人群不一致');
   if(metrics.unassigned!==(counts.get(-1)||0)||metrics.assigned+metrics.unassigned!==ids.size||metrics.groups!==[...counts.keys()].filter(g=>g>=0).length)throw new Error('未归群统计不一致');
   if(metrics.silhouette!==null&&(!Number.isFinite(metrics.silhouette)||Math.abs(metrics.silhouette)>1))throw new Error('轮廓系数无效');
   const f=w.future[method],byId=new Map(w.rows.map(r=>[r.id,r]));
   if(f.evaluated!==f.rows.length||f.returning!==f.evaluated+f.unassigned_returning||new Set(f.rows.map(r=>r.id)).size!==f.evaluated)throw new Error('后续购买人群不一致');
   for(const r of f.rows)if(!ids.has(r.id)||r.group<0||r.group!==byId.get(r.id).labels[method]||r.targets<=0||[r.group_hits,r.global_hits].some(x=>x<0||x>r.targets))throw new Error('后续购买样本不一致');
   for(const [key,hits] of [['group_recall','group_hits'],['global_recall','global_hits']]){const value=f.rows.length?f.rows.reduce((a,r)=>a+r[hits]/r.targets,0)/f.rows.length:null;if(!close(value,f[key]))throw new Error('后续购买重合率不一致');}
  }
 }
 return p;
}
let pending;
export async function loadPreference(){
 if(!pending)pending=(async()=>{
  const res=await fetch('./preference-results/manifest.json',{cache:'no-cache'});if(!res.ok)throw new Error('商品偏好分群尚未导出');
  const manifest=await res.json();if(!/^[a-f0-9]{16}\/case\.json$/.test(manifest.path))throw new Error('偏好结果路径无效');
  const response=await fetch(`./preference-results/${manifest.path}`);if(!response.ok)throw new Error('偏好结果无法读取');
  const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==manifest.sha256)throw new Error('偏好结果校验失败');
  const p=verifyPreference(JSON.parse(new TextDecoder().decode(bytes)));if(p.run_id!==manifest.run_id)throw new Error('偏好实验版本不一致');
  return {p,manifest};
 })().catch(e=>{pending=null;throw e;});
 return pending;
}
function products(rows){return rows.length?`<ul class="preference-products">${rows.map(r=>`<li><strong>${esc(r.name)}</strong><small>${esc(r.item)} · ${r.orders!=null?`买过 ${r.orders} 单`:`${r.customers} 位顾客买过 · 群内 ${pct(r.share)} · 全体 ${pct(r.overall_share)}`}</small></li>`).join('')}</ul>`:'<p>未归群顾客没有共同代表商品，不按一个客群解释。</p>';}
function personCard(r,method){return `<article><h3>顾客 ${esc(r.id)} · ${esc(groupName(method,r.labels[method]))}</h3><p class="small-note">原 RFM 群 ${r.labels.rfm+1} · 最近购买 ${num(r.rfm[0])} 天前 · ${num(r.rfm[1])} 单 · £${num(r.rfm[2])}</p>${products(r.purchases)}<p class="small-note">展示训练目录内购买次数最多的 6 件；特征覆盖 ${r.catalog_items}／${r.total_items} 件历史商品，落在训练商品目录中的历史购买参与偏好编码。</p></article>`;}
export function preferenceConclusion(w){
 const l=w.future.leiden,k=w.future.matched,h=w.metrics.hdbscan;
 return `<section class="preference-conclusion"><h2>商品偏好与客户价值需要分别分析</h2><p>本期 ${w.rows.length} 位顾客分为 ${w.metrics.leiden.groups} 个 Leiden 社群。后续购买与群体代表商品的重合率为 ${pct(l.group_recall)}，同群数 K-means 为 ${pct(k.group_recall)}；${l.group_recall>k.group_recall?'本期 Leiden 较高，仍需结合稳定性与代价判断。':'本期没有证据表明 Leiden 优于同群数 K-means。'}</p><p>HDBSCAN 保留 ${h.assigned} 位核心顾客，${pct(h.unassigned/w.rows.length)} 未归群。它适合研究密集核心群，当前不宜作为覆盖全体顾客的唯一分群方案。</p><small>已知 UCI 数据上的开发诊断；重合率不是聚类准确率、个性化推荐成绩或营销收益。</small></section>`;
}
function experience(p,w,s,lesson){
 const groups=w.profiles[s.prefMethod],filtered=w.rows.filter(r=>s.prefGroup==='all'||r.labels[s.prefMethod]===Number(s.prefGroup));
 const person=filtered.find(r=>r.id===s.prefPerson)||filtered[0];s.prefPerson=person?.id||'';
 const controls=`<div class="lesson-controls">${select('mon-prefGroup','查看群体',[['all','全部顾客'],...groups.map(g=>[g.id,`${groupName(s.prefMethod,g.id)} · ${g.n} 人`])],s.prefGroup)}${select('mon-prefPerson','匿名顾客',filtered.map(r=>[r.id,`${r.id} · ${groupName(s.prefMethod,r.labels[s.prefMethod])}`]),s.prefPerson)}</div>`;
 if(!person)return controls+'<p>当前群体没有顾客。</p>';
 const g=groups.find(g=>g.id===person.labels[s.prefMethod]);
 let reasoning=s.prefMethod==='leiden'?`该顾客在近邻图中有 ${person.graph_degree} 条连接，同社群连接占其总连接权重的 ${pct(person.graph_internal_share)}。这是局部关系支持度，不是归属正确率。Leiden 根据整张图的社区目标划分，并非按这一个比例打标签。`:s.prefMethod==='hdbscan'?`${person.labels.hdbscan<0?'该顾客未进入稳定密集群，不强制分配客群。':'该顾客进入密集核心群。'}模型归属强度 ${num(person.membership_strength)}，只描述密度层次中的归属，不是客户价值、风险或购买概率。`:s.prefMethod==='kmeans'?`最近／次近中心距离为 ${person.kmeans_distances.map(num).join('／')}，间隔 ${num(person.kmeans_distances[1]-person.kmeans_distances[0])}；接近边界时小的特征变化可能改变分组，距离不表示概率。`:s.prefMethod==='matched'?'在同一偏好向量上按最近中心分配；群数与本期 Leiden 相同，用来排除仅因分群更细而带来的差异。':'复用原 RFM 价值群。本页用偏好空间评价其商品一致性，不意味着原 RFM 价值分析无效。';
 const peer=w.rows.find(r=>r.id===person.similar_rfm);
 const support=s.prefMethod==='leiden'?table(['近邻顾客','偏好余弦相似度','Leiden 关系'],person.neighbors.map(r=>[`<button class="text-link" type="button" data-preference-person="${esc(r.id)}">${esc(r.id)}</button>`,num(r.similarity),r.same_group?'同社群':'其他社群']),'当前顾客的图邻居'):'';
 if(lesson)return controls+`<section class="m5-section"><h2>当前顾客的分群计算依据</h2>${personCard(person,s.prefMethod)}<p>${reasoning}</p>${support}<p>非零购买次数 n 经 1+ln(n)，再乘训练期 IDF＝1+ln((1+顾客数)/(1+买过该商品的顾客数))，做 L2 归一化、${p.svd_dimensions} 维 SVD 与再次归一化。群体商品占比 = 群内买过该商品的人数 ÷ 群人数；不是订单量占比。</p>${products(g.top.slice(0,3))}<p class="small-note">图路径、中心距离和密度强度是不同方法的解释，不能混成同一个置信度。</p></section>`;
 return `${preferenceConclusion(w)}${controls}<section class="m5-section"><h2>当前顾客的偏好与归属依据</h2>${personCard(person,s.prefMethod)}<p>${reasoning}</p>${support}</section>${s.prefMethod==='leiden'&&peer?`<section class="m5-section"><h2>同一 RFM 价值层，不同商品偏好</h2><p>对照顾客在同一原 RFM 群、不同 Leiden 社群中，RFM 变换距离最近；不是按未来购买效果挑选。RFM 距离 ${num(person.rfm_peer_distance)}，偏好余弦相似度 ${num(person.rfm_peer_preference_cosine)}。</p><div class="preference-pair">${personCard(person,'leiden')}${personCard(peer,'leiden')}</div><button class="outline" type="button" data-preference-person="${esc(peer.id)}">查看对照顾客的关系</button></section>`:''}<section class="m5-section"><h2>${g.id<0?'未归群人群的覆盖与价值构成':`${esc(groupName(s.prefMethod,g.id))}的代表商品与价值构成`}</h2><p>${g.n} 位顾客，占本期 ${pct(g.share)}。RFM 中位数：${num(g.rfm_median[0])} 天／${num(g.rfm_median[1])} 单／£${num(g.rfm_median[2])}。</p>${products(g.top)}${table(['原 RFM 群','群内人数','群内占比'],g.rfm_counts.map((n,i)=>[`群 ${i+1}`,n,pct(n/g.n)]),'偏好群体中的价值层构成')}<p class="small-note">代表商品按历史购买顾客数排序；商品名称仅帮助理解，不是模型使用的语义品类。可据此讨论选品／内容策略，尚未执行触达或验证运营增益。</p></section>`;
}
function report(p,w){
 return `${preferenceConclusion(w)}<section class="m5-section"><h2>特征与算法的分开对照</h2>${table(['方法','群数','已归群 / 全体','未归群','偏好空间轮廓系数','轮廓评价人数'],Object.entries(PREFERENCE_METHODS).map(([m,label])=>{const r=w.metrics[m];return [label,r.groups,`${r.assigned} / ${w.rows.length}`,pct(r.unassigned/w.rows.length),num(r.silhouette),r.silhouette_n];}),'分群方法同范围对照')}<p>RFM 与偏好 K-means 的差异包括输入特征。Leiden 与同群数 K-means 都用同一偏好向量；群数随观察时点确定，不根据后续购买选取。轮廓系数在偏好空间评估，不能否定 RFM 的价值分层用途。</p><p>HDBSCAN 仅对固定哈希评价样本中已归群的人计算轮廓系数。它排除了大量难分顾客，不能据此宣布优于覆盖全体的方法；未归群人数始终保留。</p></section><section class="m5-section"><h2>群体代表商品与后续购买的重合</h2>${table(['方法','回访人数','有群体可评估','未归群回访','群体 Top 10 重合','同人群全体热门 Top 10'],Object.entries(PREFERENCE_METHODS).map(([m,label])=>{const f=w.future[m];return [label,f.returning,f.evaluated,f.unassigned_returning,pct(f.group_recall),pct(f.global_recall)];}),'后续偏好延续诊断')}<p>先固定分群与历史代表商品，再核对未来 30 天。每人命中数 ÷ 其全部不同购买商品数，然后对有群体的回访顾客等权平均；未入目录、新商品仍保留在分母。两列对照使用各自方法相同的人群，HDBSCAN 人群不同，不能跨行直接排名。</p><p>这检验群体偏好能否延续，不是个人推荐或营销增益。未回访顾客不进入此重合率；不等于他们没有偏好。</p></section><section class="m5-section"><h2>参数与抽样稳定性</h2><p>以下为首个观察时点的固定参数探查。ARI 衡量划分一致性，不是准确率；未根据这些结果挑选新参数。</p>${table(['方法','参数变化','全体 ARI','共同已归群 ARI','共同已归群人数','变更后未归群'],p.stability.sensitivity.map(r=>[PREFERENCE_METHODS[r.method],esc(r.variation),num(r.ari_all),num(r.ari_assigned),r.jointly_assigned,r.alternative_unassigned]),'分群参数敏感性')}<details class="depth-calculation"><summary>查看三次 80% 抽样重拟合</summary>${table(['方法','抽样种子','对比人数','全体 ARI','共同已归群 ARI'],p.stability.subsamples.map(r=>[PREFERENCE_METHODS[r.method],r.seed,r.n,num(r.ari_all),num(r.ari_assigned)]),'分群抽样稳定性')}<p>固定初始特征变换，只重拟合抽样后的聚类；仅在入样顾客上比较。共同未归群可能抬高全体 ARI，因此另报共同已归群指标。</p></details></section><section class="m5-section"><h2>跨月偏好结构变化</h2><p>共同顾客 ${p.temporal.common} 位，新增 ${p.temporal.entered} 位，离开 ${p.temporal.exited} 位。两个月沿用同一商品目录／IDF／SVD；偏好算法分别重拟合，社群编号不跨月对应。</p>${table(['方法','共同顾客 ARI','共同已归群 ARI'],Object.entries(p.temporal.methods).map(([m,r])=>[PREFERENCE_METHODS[m],num(r.ari_all),num(r.ari_assigned)]),'跨月重新分群稳定性')}<p>此处混合了历史窗口、成员与模型重拟合的变化，不是原 RFM 页面“固定中心迁移”，也不作为分错客户的比例。</p></section>`;
}
function dataAndModels(p,view){
 return `<section class="m5-section"><h2>${view==='data'?'偏好数据与时间范围':'商品偏好建模流程'}</h2><p>来源为同一份 UCI Online Retail II 清洗数据，所有国家、已知顾客、正向商品交易；取消与退货排除，销售额不是净收入或利润。两期均使用观察时点前 180 天。</p><ol class="guide-flow"><li><strong>购买记录</strong><p>顾客 × 商品矩阵，值为买过该商品的不同订单数。RFM 不进入偏好向量。</p></li><li><strong>热门修正与表示</strong><p>首期至少 5 位顾客购买的 ${p.feature_catalog} 件商品；1+ln(非零订单数) 与平滑 IDF 降低频次及热门支配，经归一化、${p.svd_dimensions} 维 SVD，再归一化。变换仅首期拟合。</p></li><li><strong>分群与解释</strong><p>K-means 按向量距离；Leiden 按正相似度近邻图；HDBSCAN 按向量密度。名称用于解释代表商品，不当作已知品类；PCA 不是本轮分群算法。</p></li></ol><p>SVD 保留 TF-IDF 变异的 ${pct(p.svd_variance)}。压缩有信息损失；当前结果不证明 32 维是最优，也未加入价格／商品文本特征。</p>${table(['观察起点','原 RFM 人群','可构造偏好','无目录信息排除'],p.windows.map(w=>[w.origin,w.all_customers,w.rows.length,w.excluded_ids.length]),'偏好数据覆盖')}</section><section class="m5-section"><h2>模型设置与适用条件</h2>${table(['方法','本次实际设置','适用边界'],[['K-means','K=4；另以 Leiden 的群数作为对照；n_init=10','需要固定数量、全体分配；球状距离结构假设可能不适合复杂群体'],['Leiden','15 个余弦近邻，正权重无向并集图；RB 分区，分辨率 1','社群受建图和分辨率影响；不能把图上的接近解释为实际社交关系'],['HDBSCAN','最小群 30 人、min_samples=10、欧氏距离、EOM','允许未归群；本次大量未归群，不应直接用于全量客户运营']],'偏好模型实际设置')}<p>训练、参数探查与后续统计均按预先保存的协议执行；属于已有公开结果反馈后的开发实验。没有正确客群标签，不报告聚类准确率。</p></section>`;
}
export function renderPreference(p,s,view){
 const w=p.windows.find(w=>w.origin===s.origin)||p.windows[0];s.origin=w.origin;
 if(!Object.hasOwn(PREFERENCE_METHODS,s.prefMethod))s.prefMethod='leiden';
 if(s.prefGroup!=='all'&&!w.profiles[s.prefMethod].some(g=>String(g.id)===s.prefGroup))s.prefGroup='all';
 const controls=['data','models'].includes(view)?'':`<div class="lesson-controls">${select('mon-origin','偏好观察时点',p.windows.map(w=>[w.origin,w.origin]),s.origin)}${select('mon-prefMethod','偏好分析方法',Object.entries(PREFERENCE_METHODS),s.prefMethod)}</div>`;
 return `${controls}${['data','models'].includes(view)?dataAndModels(p,view):view==='report'?report(p,w):experience(p,w,s,view==='learn')}<details class="depth-calculation"><summary>偏好实验版本与来源</summary><p class="hash-text">${esc(p.run_id)}；原 RFM ${esc(p.parent_run)}。</p><p>原训练结果保留，本轮为独立偏好实验。分群及代表商品先冻结，再附加后续购买诊断；没有触达客户或在线训练。</p><pre class="monitoring-notice">${esc(p.notice)}</pre></details>`;
}

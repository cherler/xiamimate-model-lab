import {dressipiEvidence} from './evidence-bridge.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>v==null?'不适用':`${(v*100).toFixed(2)}%`;
const num=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const fixed=v=>v==null?'—':v.toFixed(5);
const table=(heads,rows,label)=>`<div class="table-scroll" tabindex="0" role="region" aria-label="${label}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const STUDY_NAMES={behavior:'行为特征',attributes:'属性特征',combined:'行为＋属性',full:'完整匹配特征（首轮模型）'};
export const DRESSIPI_FEATURES={
 log_purchase_count:['行为','候选商品历史购买次数的 log(1+x)'],
 cooccurrence_score:['行为','浏览商品指向候选购买的共现得分；按浏览先后衰减'],
 popularity_rank:['行为','候选在历史热门召回中的名次；未进入该路前 100 则记 101'],
 cooccurrence_rank:['行为','候选在浏览→购买共现召回中的名次；缺失记 101'],
 attribute_score:['属性','候选与浏览商品的属性 Jaccard 相似度，按浏览先后加权求和'],
 attribute_rank:['属性','候选在匿名属性召回中的名次；缺失记 101'],
 candidate_attribute_count:['属性','候选商品的匿名属性类别和值对数量'],
 session_length:['会话上下文','当前会话浏览次数，包括重复浏览'],
 session_unique_items:['会话上下文','当前会话浏览过的不同商品数'],
 shared_last_attributes:['匹配','候选与最后浏览商品共有的属性对数量'],
 last_attribute_jaccard:['匹配','候选与最后浏览商品的属性交集数 / 并集数'],
 matched_view_items:['匹配','与候选至少共享一个属性对的已浏览商品数']
};
export const FAILURE_NAMES={not_retrieved:'未进入候选池',rank_after_100:'已召回，排在 100 名之后',rank_11_100:'位于第 11～100 名',rank_1_10:'位于前 10 名'};
export function failureCounts(summary){
 const entries=Object.entries(FAILURE_NAMES).map(([id,label])=>({id,label,count:summary.states[id],share:summary.sessions?summary.states[id]/summary.sessions:0}));
 if(entries.some(e=>!Number.isInteger(e.count)||e.count<0)||entries.reduce((n,e)=>n+e.count,0)!==summary.sessions)throw new Error('失败原因计数与验证人群不一致');
 return entries;
}
export function renderDressipiDetails(host,r,manifest,names,view,study=null){
 const titles={models:['Dressipi 特征与模型说明','介绍三路召回、12 项排序特征，以及各类模型的输入和计算方法。'],report:['Dressipi 推荐评估报告','比较同一批四月会话上的推荐表现，并区分候选召回与排序阶段的误差。'],training:['Dressipi 训练配置与运行记录','记录数据切分、抽样范围、模型参数、特征实验和实际训练成本。']};
 const [title,subtitle]=titles[view];
 host.innerHTML=`<div class="breadcrumb">商品推荐<span>/</span>Dressipi · ${view==='models'?'特征与模型':view==='report'?'效果报告':'训练记录'}</div><header class="m5-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><span class="badge">开发验证</span></header><p class="showcase-boundary">2021 年 4 月 · ${num(r.cohort.validation_sessions)} 个固定抽样会话 · 四月已用于首轮结果反馈，后续特征实验仍属于开发验证。</p>${view!=='training'?dressipiEvidence(study):''}${view==='models'?models():view==='training'?training():report()}<footer class="showcase-source"><p>首轮运行 <code class="hash-text">${esc(r.run_id)}</code>${study?`；特征实验 <code class="hash-text">${esc(study.run_id)}</code>`:''}。</p><p><a href="./dressipi-results/${manifest.resources.report.path}" download>下载首轮训练报告</a>${study?` · <a href="./dressipi-results/${manifest.resources.study.path}" download>下载诊断与特征实验报告</a>`:''} · <a href="#recommend?case=dressipi&view=data">数据来源与使用范围</a></p><p>研究实验展示；数据使用范围以 Dressipi 官方条款为准，本站不授予数据再分发或商业使用许可。</p></footer>`;
 const group=host.querySelector('#dressipi-diagnostic-group');
 if(group){group.onchange=()=>drawGroups(group.value);drawGroups(group.value);}
 function models(){
  return `<section class="case-story"><h2>候选召回与排序流程</h2><ol class="case-steps"><li>使用 3 月前的 ${num(r.cohort.base_sessions)} 个会话建立购买热门度、浏览→购买共现关系和商品属性索引。</li><li>三路各取前 100 件商品，合并去重并排除本会话已浏览商品，得到最多 300 个候选。</li><li>LightGBM LambdaRank 用 3 月会话学习候选顺序，输出前 100。交互体验页展示前 10，并另列真实购买目标在前 100 中的位置。</li></ol><p>候选生成只读取当前浏览与冻结统计。真实购买标签用于训练和事后评分，不补入漏召回的候选。</p></section><section class="m5-section"><h2>模型与规则基线</h2>${table(['方法','计算方式','适用条件与限制'],[['历史购买热门','按冻结统计中的购买次数排序','无需关联浏览历史；容易集中在热门商品。'],['浏览→购买共现','计算历史浏览商品到购买商品的关联，按浏览先后加权','依赖历史交互；低频商品和新关系可能没有支持。'],['匿名属性相似','累加候选与浏览商品的属性 Jaccard 相似度','可为交互稀少的商品提供匹配信号；属性没有自然语言含义。'],['LightGBM LambdaRank','从候选的行为、属性和匹配特征中学习树模型排序','排序上限受候选召回约束，无法找回未进入候选池的商品。']],'推荐模型原理')}<p class="m5-caption">三种召回中的并列得分均用冻结购买热门度和商品编号打破平局。因此“属性相似”也包含热门度的平局规则。</p></section><section class="m5-section"><h2>12 项输入特征</h2>${table(['特征','分组','定义'],r.features.map(f=>[esc(f),DRESSIPI_FEATURES[f]?.[0]||'待核对',DRESSIPI_FEATURES[f]?.[1]||'待核对']),'Dressipi 排序特征字典')}<p class="m5-caption">行为统计在 3 月前冻结；会话特征仅来自当前浏览；商品属性来自给定目录。商品名称、图片、品牌解释和未来购买标签均未作为输入。</p></section>${ablation()}${study?`<section class="m5-section"><h2>完整模型的训练特征重要性</h2>${table(['特征','训练分裂增益占比'],gainRows(study.feature_gain.full),'完整模型特征增益')}<p class="m5-caption">占比以全部特征的训练 gain 为分母。相关特征会分摊增益；这是训练使用程度，特征贡献的对照见上方消融实验，均不属于因果证明。</p></section>`:''}`;
 }
 function gainRows(features){const total=features.reduce((s,f)=>s+f.gain,0);return [...features].sort((a,b)=>b.gain-a.gain).map(f=>[esc(f.feature),pct(total?f.gain/total:0)]);}
 function ablation(){
  if(!study)return '<section class="m5-section"><h2>特征消融实验</h2><p class="m5-caption">当前数据包尚未包含经核验的特征实验结果。</p></section>';
  const base=study.models.behavior;
  return `<section class="m5-section"><h2>排序特征消融对照</h2><p class="m5-caption">四组使用同一候选池、训练查询、验证会话与 LambdaRank 参数。仅改变排序输入列；完整组复用首轮权重，并逐会话复现原推荐列表。会话长度与不同浏览商品数为各组共用的上下文。</p>${table(['特征组','输入列数','MRR@100 ↑','Recall@100 ↑','Recall@10 ↑','MRR 相对行为组差值'],Object.entries(study.models).map(([k,m])=>[STUDY_NAMES[k],study.protocol.variants[k].length,fixed(m['mrr@100']),pct(m['recall@100']),pct(m['recall@10']),`${m['mrr@100']-base['mrr@100']>=0?'+':''}${fixed(m['mrr@100']-base['mrr@100'])}`]),'排序特征消融结果')}<details><summary>各组实际输入</summary>${table(['特征组','输入列'],Object.entries(study.protocol.variants).map(([k,features])=>[STUDY_NAMES[k],features.map(esc).join('、')]),'消融输入列')}</details><p class="m5-tradeoff">这是固定召回条件下的排序消融。行为组也使用属性参与生成的候选池，属性排名也受热门度平局规则影响；不能解释成完全不使用另一类信息的端到端系统。单种子、抽样开发验证的差异不代表线上收益或统计显著性。</p></section>`;
 }
 function report(){
  const baseline=table(['方法','MRR@100 ↑','Recall@100 ↑'],Object.entries(names).map(([id,name])=>[name,fixed(r.models[id]['mrr@100']),pct(r.models[id]['recall@100'])]),'首轮推荐模型评分');
  let diagnostics='<section class="m5-section"><h2>召回与排序诊断</h2><p>当前数据包尚未包含经核验的逐会话诊断。</p></section>';
  if(study){const overall=study.diagnostics.overall,entries=failureCounts(overall);
   diagnostics=`<section class="m5-section"><h2>完整模型：召回与排序阶段分解</h2><p class="m5-caption">互斥分组覆盖全部 ${num(overall.sessions)} 个验证会话。未进入候选的购买目标，无法通过候选内排序找回。</p><div class="dressipi-funnel">${entries.map(e=>`<div><span>${e.label}</span><strong>${num(e.count)}<small> 个会话 · ${pct(e.share)}</small></strong><div class="m5-gain-track"><i style="width:${e.share*100}%"></i></div></div>`).join('')}</div><p class="m5-caption">候选召回率 ${pct(overall.retrieval_recall)}；全体验证 Recall@100 ${pct(overall['recall@100'])}。已召回的 ${num(overall.retrieved)} 个会话中，${pct(overall['conditional_recall@100'])} 的目标排入前 100；这一条件指标不代替全体指标。</p></section><section class="m5-section"><h2>各召回通道的覆盖</h2>${table(['通道','找回目标的会话数','占全部会话','仅此通道找回'],Object.entries(study.diagnostics.channels).map(([k,v])=>[names[k],num(v.hits),pct(v.recall),num(v.unique_hits)]),'召回通道覆盖')}<p class="m5-caption">同一个目标可以同时被多个通道召回，前三列不可直接相加。最后一列指其他两路均未找回的目标；不是移除该通道后重新训练的模型增益。</p></section><section class="m5-section"><h2>完整模型的分组表现</h2><div class="m5-controls"><label>分析维度<select id="dressipi-diagnostic-group"><option value="session_length">会话浏览次数</option><option value="target_purchase_count">目标商品历史购买次数</option><option value="last_attribute_count">最后浏览商品的属性数量</option><option value="view_attribute_coverage">浏览商品属性覆盖</option></select></label></div><div id="dressipi-group-table"></div><p class="m5-caption">分组边界在本轮实验前固定；分组用于事后描述，不用于筛选验证样本或构造模型特征。目标商品热度取自冻结的基础购买统计。小样本分组不足以支持稳定性结论。</p></section>`;
  }
  return `<section class="m5-section"><h2>首轮模型对比</h2>${baseline}<p class="m5-caption">MRR@100 为购买目标在前 100 中排名倒数的会话平均值；Recall@100 为命中前 100 的会话比例。所有会话均计入分母，漏召回与未命中均记零。</p></section>${diagnostics}${ablation()}<section class="m5-section"><h2>评估范围与后续实验</h2><p class="m5-caption">当前结果来自同一批 1,000 个四月开发会话。完整模型和各通道的覆盖差异可用于安排后续召回实验；扩大候选池后需重新评估排序质量、计算成本与全体指标。本节为固定候选的特征实验；召回扩展使用独立协议另行展示。图召回与新一轮超参搜索尚未运行。</p></section>`;
 }
 function drawGroups(field){
  const labels={none:'无属性',partial:'部分商品有属性',complete:'全部商品有属性'};
  host.querySelector('#dressipi-group-table').innerHTML=table(['分组','会话数','候选召回率','MRR@100','Recall@100','Recall@10'],study.diagnostics.groups[field].map(g=>[labels[g.group]||(field==='session_length'&&g.group==='0–1'?'1':g.group),num(g.sessions),pct(g.retrieval_recall),fixed(g['mrr@100']),pct(g['recall@100']),pct(g['recall@10'])]),'分组推荐表现');
 }
 function training(){
  const c=r.cohort,p=r.protocol.params;
  return `<section class="case-story"><h2>数据切分与样本范围</h2>${table(['阶段','时间','固定样本'],[['基础统计','2021-03-01 之前',`${num(c.base_sessions)} 个会话`],['排序训练','2021-03-01～03-31',`${num(c.ranking_sessions)} 个预选会话；${num(c.ranking_fitted_queries)} 个参与拟合`],['开发验证','2021-04-01～04-30',`${num(c.validation_sessions)} 个会话，全部计入评分`]],'训练与验证范围')}<p>完整会话按时间划分，按会话编号 SHA-256 固定抽样。训练中 ${num(c.ranking_retrieval_misses)} 个会话未召回正样本，无法学习候选间排序，因此不参与拟合；验证不做此过滤。</p></section><section class="m5-section"><h2>LightGBM 排序参数</h2>${table(['设置','数值'],[['目标函数',esc(p.objective)],['树数量',p.n_estimators],['叶子数',p.num_leaves],['学习率',p.learning_rate],['叶子最少样本',p.min_child_samples],['随机种子',p.random_state],['CPU 线程',p.n_jobs]],'排序模型参数')}<p class="m5-caption">固定参数，无超参搜索。基础统计与首轮特征准备、排序拟合合计 ${num(r.cost.fit_seconds)} 秒；首轮全流程 ${num(r.cost.total_seconds)} 秒。</p></section>${study?`<section class="m5-section"><h2>特征实验计算成本</h2>${table(['特征组','排序拟合耗时','验证预测耗时','模型来源'],Object.entries(study.cost.models).map(([k,cost])=>[STUDY_NAMES[k],cost.fit_seconds==null?'复用，未重训':`${num(cost.fit_seconds)} 秒`,`${num(cost.predict_seconds)} 秒`,cost.reused?'首轮已保存权重':'本轮训练']),'消融训练成本')}<p class="m5-caption">共享数据与候选准备 ${num(study.cost.preparation_seconds)} 秒。预测耗时包含本地逐会话计算与排序，不是线上服务延迟。首轮总拟合计时含特征准备，不能直接与本表的纯排序拟合耗时比较。</p></section><section class="m5-section"><h2>一致性核验</h2><ul class="case-limits"><li>源数据哈希、首轮报告、原训练代码和模型权重均已核验。</li><li>验证会话、目标、候选池与三路召回列表逐条等于首轮记录。</li><li>完整模型的全部前 100 推荐列表与首轮一致；其余组仅改变排序输入列。</li><li>诊断分组、失败阶段计数和消融指标从保存的逐会话预测重新计算。</li></ul><p class="m5-caption">特征协议 ${esc(study.protocol.version)}；四月已经反馈过模型表现，本轮为后续开发实验，不是新增独立测试。</p></section>`:''}<section class="m5-section"><h2>当前实现范围</h2><p class="m5-caption">已完成三路召回、LightGBM 排序、开发评估与案例回放${study?'，以及固定候选的排序特征消融与失败诊断':''}。尚未实现冠军 GNN 管线、全量竞赛训练、线上实验与云端训练调度。</p></section>`;
 }
}

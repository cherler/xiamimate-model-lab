import {dressipiEvidence} from './evidence-bridge.js';
import {recommendationCohort} from './case-comparison.js';
import {dressipiDuel,dressipiGroups} from './case-depth.js';
import { renderRetrievalCoverage } from './coverage-studies.js';
import { renderDressipiDetails } from './dressipi-details.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const DRESSIPI_MODELS={lightgbm:'LightGBM · 属性与行为排序',cooccurrence:'浏览→购买共现',attributes:'匿名属性相似',popularity:'历史购买热门'};
const pct=v=>`${(v*100).toFixed(2)}%`;
export function reciprocalRank(target,ranking,k=100){const i=ranking.slice(0,k).indexOf(target);return i<0?0:1/(i+1);}
export function attributeOverlap(left,right){const a=new Set(left.map(p=>JSON.stringify(p)));return right.filter(p=>a.has(JSON.stringify(p)));}
export async function renderDressipi(host,isCurrent,routeParams){
 host.innerHTML='<p class="loading-copy">正在读取 Dressipi 本地实验…</p>';
 try{
  const response=await fetch('./dressipi-results/manifest.json',{cache:'no-store'});
  if(response.status===404){if(isCurrent())host.innerHTML='<section class="report-panel"><span class="badge">本地研究案例</span><h1>Dressipi · 会话内商品推荐</h1><p>根据当前浏览顺序与匿名商品属性，预测本次会话将购买的商品。</p><p>当前构建未包含本地研究结果。训练产物核验并导出后，可在本地预览中查看。</p><a class="text-link" href="#recommend?case=tafeng">体验已完成的 Ta Feng 推荐 →</a></section>';return;}
  if(!response.ok)throw new Error('展示清单读取失败');const manifest=await response.json();
  if(manifest.schema!==1||manifest.public_export_allowed!==false||!/^\w[\w-]+$/.test(manifest.run_id))throw new Error('实验清单无效');
  const loaded=await Promise.all(['report','samples',...(manifest.resources.study?['study']:[]),...(manifest.resources.coverage?['coverage']:[])].map(async key=>{
   const spec=manifest.resources[key];if(!spec||!/^[a-f0-9]{16}\/[a-z]+\.json$/.test(spec.path))throw new Error('资源路径无效');
   const r=await fetch(`./dressipi-results/${spec.path}`);if(!r.ok)throw new Error('实验文件缺失');const bytes=await r.arrayBuffer();
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==spec.sha256)throw new Error('实验校验失败');return JSON.parse(new TextDecoder().decode(bytes));
  }));if(!isCurrent())return;
  const [report,bundle]=loaded;if(report.run_id!==manifest.run_id||bundle.run_id!==manifest.run_id||report.status!=='complete_development')throw new Error('版本或运行状态不一致');
  const study=manifest.resources.study?loaded[2]:null;
  const coverage=manifest.resources.coverage?loaded[manifest.resources.study?3:2]:null;
  if(coverage&&(coverage.report.base_run_id!==manifest.run_id||coverage.report.status!=='complete_development'||coverage.report.public_export_allowed!==false))throw new Error('召回实验版本不一致');
  if(study&&(study.base_run_id!==manifest.run_id||study.status!=='complete_development_study'||study.public_export_allowed!==false))throw new Error('特征实验与首轮版本不一致');
  const view=(routeParams||new URLSearchParams(location.hash.split('?')[1]||'')).get('view');
  if(['models','report','training'].includes(view)){renderDressipiDetails(host,report,manifest,DRESSIPI_MODELS,view,study);if(coverage&&view==='report')renderRetrievalCoverage(host,coverage,manifest);return;}
  const samples=bundle.samples;let model='lightgbm',baseline='cooccurrence',index=0,filter='all',group='session_length';
  host.innerHTML=`<div class="breadcrumb">商品推荐<span>/</span>Dressipi 会话推荐</div><div class="page-heading"><div><h1>Dressipi 会话商品推荐</h1><p>根据顾客本次浏览，为下一次购买推荐 10 件商品；比较行为规则与学习排序的结果。</p></div><span class="badge">本地 CPU · 开发实验</span></div><p class="showcase-boundary">2021 年 4 月本地开发验证 · 固定抽取 ${report.cohort.validation_sessions.toLocaleString()} 个完整会话 · 全目录 ${report.cohort.catalogue_items.toLocaleString()} 件商品。不是官方测试或独立确认成绩。</p><div class="showcase-controls"><label>推荐模型<select id="dressipi-model">${Object.entries(DRESSIPI_MODELS).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>对照方法<select id="dressipi-baseline">${Object.entries(DRESSIPI_MODELS).map(([id,name])=>`<option value="${id}" ${id===baseline?'selected':''}>${name}</option>`).join('')}</select></label><label>样本结果筛选<select id="dressipi-filter"><option value="all">全部固定样本</option><option value="improved">目标排名改善</option><option value="tied">倒数名次持平</option><option value="worse">目标排名退步</option></select></label><label>浏览会话<select id="dressipi-session">${samples.map((s,i)=>`<option value="${i}">会话 ${esc(s.session)} · ${s.sequence.length} 次浏览</option>`).join('')}</select></label></div><p id="dressipi-pair-summary" class="small-note" aria-live="polite"></p><div id="dressipi-population-pair" class="depth-verdict"></div><div id="dressipi-content"></div>${dressipiEvidence(study)}<section class="report-panel"><h2>按会话与商品特征分组的命中表现</h2><label>全体分组维度<select id="dressipi-depth-group"><option value="session_length">会话浏览次数</option><option value="target_purchase_count">目标商品历史购买次数</option><option value="last_attribute_count">最后浏览商品属性数量</option><option value="view_attribute_coverage">浏览商品属性覆盖</option></select></label><div id="dressipi-depth-groups"></div></section><section class="report-panel"><h2>验证集模型对比</h2><div class="table-scroll" tabindex="0" role="region" aria-label="Dressipi 模型评估"><table><thead><tr><th>模型</th><th>MRR@100 ↑</th><th>Recall@100 ↑</th></tr></thead><tbody>${Object.entries(DRESSIPI_MODELS).map(([id,name])=>`<tr><th scope="row">${name}</th><td>${report.models[id]['mrr@100'].toFixed(5)}</td><td>${pct(report.models[id]['recall@100'])}</td></tr>`).join('')}</tbody></table></div><p class="small-note">所有会话均计入分母，未召回真实商品也计为失败。三路候选联合找回率 ${pct(report.retrieval.retrieval_recall)}；候选召回率反映目标商品的可检索程度，MRR 反映最终排序质量。MRR 不是购买概率。</p></section><section class="report-panel"><h2>商品属性与排序流程</h2><ol class="guide-flow"><li><strong>三路召回</strong><p>热门、浏览→购买共现、匿名属性相似各取 100，去重后最多 300 个候选，排除本会话已浏览商品。</p></li><li><strong>特征交叉</strong><p>候选热门度、三路排名和匹配分数、与最后浏览商品的属性交集、Jaccard 相似度、会话长度等 ${report.features.length} 项输入。</p></li><li><strong>排序学习</strong><p>LightGBM LambdaRank 从 3 月会话学习候选顺序，固定参数后在 4 月验证，不把漏召回的真实答案补入候选。</p></li></ol><details><summary>训练范围与时间边界</summary><p>基础统计使用 3 月前的 ${report.cohort.base_sessions.toLocaleString()} 个会话；3 月排序训练预选 ${report.cohort.ranking_sessions.toLocaleString()} 个会话，其中 ${report.cohort.ranking_retrieval_misses.toLocaleString()} 个未召回正样本，不用于拟合排序树。4 月验证保留全部预选会话。各分区按完整会话划分，按会话编号哈希抽样，不按结果挑选。</p><p>这是独立实现的 CPU 小规模实验，尚未实现冠军 GNN 管线；参数未用本次验证成绩调优。验证人群、候选与官方比赛不同，不进行分数对标。</p><p>基础统计与排序拟合共 ${(report.cost.fit_seconds/60).toFixed(1)} 分钟。原始训练数据、模型与逐会话预测保留在本地。</p></details></section><footer class="showcase-source"><p>来源：Dressipi RecSys 2022，使用可追溯第三方训练文件镜像。商品与属性均为匿名编码，不推测品牌、颜色或商品名称。当前仅限本地研究预览，默认公开构建排除此数据包。</p><details><summary>版本与报告</summary><p>${esc(report.run_id)}</p><a href="./dressipi-results/${manifest.resources.report.path}" download>下载本地实验报告</a></details></footer>`;
  const content=host.querySelector('#dressipi-content');
  function draw(){
   const cohort=recommendationCohort(samples,model,baseline),shown=cohort.rows.filter(r=>filter==='all'||r.result.status===filter);
   const picker=host.querySelector('#dressipi-session');
   if(!shown.some(r=>r.sample===samples[index]))index=shown.length?samples.indexOf(shown[0].sample):-1;
   picker.innerHTML=shown.length?shown.map(r=>`<option value="${samples.indexOf(r.sample)}">会话 ${esc(r.sample.session)} · ${r.sample.sequence.length} 次浏览</option>`).join(''):'<option value="">没有符合条件的样本</option>';
   picker.disabled=!shown.length;if(index>=0)picker.value=String(index);
   host.querySelector('#dressipi-pair-summary').textContent=`固定 ${cohort.total} 个展示样本：改善 ${cohort.counts.improved}、持平 ${cohort.counts.tied}、退步 ${cohort.counts.worse}；按目标 RR@100 差值分类。当前显示 ${shown.length} 个。这些是原先固定保留的样本，不是全部 ${report.cohort.validation_sessions} 会话的改善占比。`;
   const currentReport=report.models[model],baseReport=report.models[baseline];
   host.querySelector('#dressipi-population-pair').innerHTML=`<strong>全部 ${report.cohort.validation_sessions.toLocaleString()} 个开发会话：前 100 命中比例 ${pct(baseReport['recall@100'])} → ${pct(currentReport['recall@100'])}</strong><p>对照 ${esc(DRESSIPI_MODELS[baseline])}，当前 ${esc(DRESSIPI_MODELS[model])}；差值 ${((currentReport['recall@100']-baseReport['recall@100'])*100).toFixed(2)} 个百分点。此处统计前 100，下面列表展示前 10；前 100 的命中不一定出现在前 10 列表。<a href="#recommend?case=dressipi&view=report">查看排序质量、候选上限与计算范围</a>。</p>`;
   content.innerHTML=index<0?'<section class="depth-input" role="status"><h2>没有符合条件的展示样本</h2><p>请切换筛选或方法；不能据此断言全体验证没有此类结果。</p></section>':dressipiDuel(samples[index],model,baseline,DRESSIPI_MODELS);
   host.querySelector('#dressipi-depth-groups').innerHTML=dressipiGroups(study,group);
  }
  host.querySelector('#dressipi-model').onchange=e=>{model=e.target.value;draw();};
  host.querySelector('#dressipi-baseline').onchange=e=>{baseline=e.target.value;draw();};
  host.querySelector('#dressipi-filter').onchange=e=>{filter=e.target.value;draw();};
  host.querySelector('#dressipi-session').onchange=e=>{index=Number(e.target.value);draw();};
  host.querySelector('#dressipi-depth-group').onchange=e=>{group=e.target.value;host.querySelector('#dressipi-depth-groups').innerHTML=dressipiGroups(study,group);};
  draw();if(coverage)renderRetrievalCoverage(host,coverage,manifest,true);
 }catch(error){if(isCurrent())host.innerHTML=`<section class="report-panel"><h1>Dressipi 结果暂不可用</h1><p>${esc(error.message)}</p><p>请检查本地结果数据包是否完整，再重新加载。</p></section>`;}
}
